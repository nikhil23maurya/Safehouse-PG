import { test, expect } from "@playwright/test";
import { setup, go, noOverflow } from "./helpers.js";
import fs from "node:fs/promises";

export async function platform(page, { billing = false, pendingAmount = null, orderAmount = 100 } = {}) {
  await page.addInitScript((enableBilling) => {
    window.__platformVault = JSON.parse(sessionStorage.getItem("synthetic-vault")||"null");
    window.__planState=JSON.parse(sessionStorage.getItem("synthetic-plan")||"null");
    window.__phoneSends = 0;
    window.SafeHouseNative = {
      getPackageId: () => "com.safehouse.pg.testing",
      ready: () => {},
      getPlanPaymentState:()=>JSON.stringify(window.__planState||{}),
      acknowledgePlanPayment:()=>{window.__planState=null;sessionStorage.removeItem("synthetic-plan");},
      getSession: () =>
        window.__platformVault ? JSON.stringify(window.__platformVault) : null,
      saveSession: (raw) => {
        window.__platformVault = raw ? JSON.parse(raw) : null;
        sessionStorage.setItem("synthetic-vault",JSON.stringify(window.__platformVault));
        return true;
      },
      ...(enableBilling ? { openPlanRazorpayUpi: (raw) => {
        if(!window.__nativeCallbackWrapped){
          const callback=window.PGOnePlanPaymentResult;
          window.PGOnePlanPaymentResult=(order,status,message)=>{
            window.__planState={...window.__planState,orderId:order,status,message};
            sessionStorage.setItem("synthetic-plan",JSON.stringify(window.__planState));callback(order,status,message);
          };window.__nativeCallbackWrapped=true;
        }
        window.__lastPlanOptions = JSON.parse(raw);
        window.__planState={organisationId:window.__lastPlanOptions.organisationId,orderId:window.__lastPlanOptions.order_id,status:"DISCOVERING"};
      } } : {}),
    };
  }, billing);
  const fixtures = await setup(page);
  const account = {
    id: "pg-account-1",
    fullName: "",
    phoneE164: "+919123456789",
    email: null,
    credentialReady:true,
    emailVerified: false,
    setupIntent: null,
  };
  const memberships = [];
  const requests=[];
  let selected = null;
  let propertiesCreated = 0;
  let paid = false;
  let exactCaptured=true;
  const tokens = () => ({
    kind: "PLATFORM",
    accessToken: `pg1.test.${selected || "account"}`,
    refreshToken: "pg1.test.refresh",
  });
  const snapshot = () => ({
    account,
    memberships: memberships.map(m => ({ ...m, organisation: { ...m.organisation, entitled: paid } })),
    membershipId: selected,
    property: selected ? memberships.find(m=>m.id===selected)?.property : null,
    student: null,
    user: {
      id: "owner1",
      fullName: account.fullName,
      email: account.email,
      role: selected ? (memberships[0].role==="RESIDENT"?"STUDENT":"OWNER") : "ACCOUNT",
      mustChangePassword: false,
    },
  });
  await page.route("**/api/platform/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON() || {};
    let data;
    if (path.endsWith("/config"))
      data = {
        enabled: true,
        plan:{amountPaise:100,currency:"INR"},
        androidBilling: billing ? "CUSTOM_UPI_INTENT" : "NOT_CONFIGURED",
        authentication:"EMAIL_PASSWORD",phone:null,recoveryAvailable:true,
        legal: {
          terms: "https://example.test/terms",
          privacy: "https://example.test/privacy",
        },
      };
    else if (path.endsWith("/register") || path.endsWith("/login")) { account.email=body.email; data={tokens:tokens()}; }
    else if (path.endsWith("/forgot-password")) data={ok:true,message:"If this email has an eligible account, a recovery link will arrive shortly."};
    else if (path.endsWith("/logout")) data={ok:true};
    else if (path.endsWith("/session")) data = snapshot();
    else if(path.endsWith("/onboarding-intent")){account.setupIntent=body.intent;data={ok:true};}
    else if(path.endsWith("/resident-requests")){data={requests};}
    else if(path.endsWith("/join")){
      if(body.code!=="ABCD-EFGH-JKLM")return route.fulfill({status:404,json:{error:{code:"PG_CODE_UNAVAILABLE",message:"Invalid PG code."}}});
      if(!requests.length)requests.push({id:"request1",propertyId:"joined-property",propertyName:"Resident PG",fullName:body.fullName,mobile:body.mobile,status:"PENDING",createdAt:new Date().toISOString()});data={pendingApproval:true,requestId:"request1",status:requests[0].status};
    }
    else if (path.endsWith("/profile")) {
      Object.assign(account, {
        fullName: body.fullName,
        contactPhone: body.contactPhone,
        setupIntent: body.intent,
      });
      data = snapshot();
    } else if (path.endsWith("/properties")) {
      if (!memberships.some(m=>m.property.name===body.name)) {
        propertiesCreated++;
        memberships.push({
          id: `membership${propertiesCreated}`,
          role: "OWNER",
          organisation: { id: "org1", name: body.name, legacyAccess: false },
          property: {
            id: `property${propertiesCreated}`,
            name: body.name,
            timezone: "Asia/Kolkata",
            currency: "INR",
          },
        });
      }
      const created=memberships.at(-1).property,existing=fixtures.properties.find(p=>p.id===created.id);
      if(existing)Object.assign(existing,created);else fixtures.properties.push({...created});
      data = { ...snapshot(), property: created };
    } else if (path.endsWith("/workspace")) {
      selected = body.membershipId;
      data = { tokens: tokens() };
    } else if (path.endsWith("/subscription"))
      data = {
        entitled: paid,
        legacyAccess: false,
        configured: billing,
        plan:{amountPaise:100,currency:"INR"},
        pendingOrder:pendingAmount?{providerOrderId:"order_SYNTHETIC001",amountPaise:pendingAmount,status:"PENDING"}:null,
        mode: "MANUAL_MONTHLY",
        recurring: false,
        tax: null,
        subscription: null,
      };
    else if (path.endsWith("/plan/android/orders")) {
       expect(billing).toBe(true);
       expect(body).toMatchObject({ accepted:true, amountPaise:100, recurring:false });
       expect(body.requestKey.length).toBeGreaterThanOrEqual(16);
       data = { id:"pg-plan-order-one", orderId:"order_SYNTHETIC001", keyId:"rzp_test_SYNTHETIC001",
         amountPaise:orderAmount, currency:"INR", recurring:false, payable:true };
     } else if (path.endsWith("/subscription/recheck")) {
       data = { entitled: paid };
     } else if (path.endsWith("/merchant"))
      data = {
        status: "NOT_CONNECTED",
        bank: null,
        message:
          "Online payment setup is awaiting payment-provider activation.",
        onboardingAvailable: false,
      };
    else if(path.endsWith("/state")&&path.includes("/plan/orders/"))data={orderId:"order_SYNTHETIC001",captured:paid&&exactCaptured,status:paid&&exactCaptured?"CAPTURED":"VERIFYING",receipt:paid&&exactCaptured?{id:"synthetic-receipt",number:"SYNTHETIC-249",amountPaise:100,paidAt:"2026-11-10T10:00:00Z",periodEnd:"2026-12-10T10:00:00Z"}:null};
    else if(path.endsWith("/join-code"))data={code:"ABCD-EFGH-JKLM",enabled:true,revision:1};
    else if (path.endsWith("/members")) data = { members: [] };
    else if (path.endsWith("/invitations")) data = { invitations: [] };
    else
      return route.fulfill({
        status: 404,
        json: {
          error: { code: "NOT_FOUND", message: "Fixture route unavailable" },
        },
      });
    await route.fulfill({
      json: data,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  });
  await page.route("**/api/owner/students?**", (route) =>
    route.fulfill({
      json: {
        students: [
          {
            id: "resident1",
            name: "Ananya Rao",
            mobile: "9123456780",
            status: "ACTIVE",
          },
        ],
      },
    }),
  );
  await page.route("**/api/owner/properties",route=>route.fulfill({json:{properties:memberships.filter(m=>m.role==="OWNER").map(m=>m.property)}}));
  return {
    ...fixtures,
    requests,
    approveRequest(){requests[0].status="ACTIVE";requests[0].membershipId="resident-membership";memberships.push({id:"resident-membership",role:"RESIDENT",organisation:{id:"joined-org",name:"Resident PG",legacyAccess:false},property:{id:"joined-property",name:"Resident PG",timezone:"Asia/Kolkata",currency:"INR"}});},
    get propertiesCreated() {
      return propertiesCreated;
    },
    activatePaid() { paid = true; },
    setOrderCaptured(value){exactCaptured=value;},
    get entitled() { return paid; },
  };
}
