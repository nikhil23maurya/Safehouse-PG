// Controlled fixtures. This module and its generated native harness are test-only.
export function createFixtures() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "numeric",
  }).formatToParts(new Date());
  const current = {
    year: Number(parts.find((p) => p.type === "year").value),
    month: Number(parts.find((p) => p.type === "month").value),
  };
  const property1 = {
    id: "property1",
    name: "Maple House",
    currency: "INR",
    timezone: "Asia/Kolkata",
  };
  const property2 = {
    id: "property2",
    name: "Cedar House",
    currency: "INR",
    timezone: "Asia/Kolkata",
  };
  const properties = [property1, property2];
  const owner = {
    id: "owner1",
    fullName: "Rohan Mehta",
    email: "owner@example.test",
    role: "OWNER",
    mustChangePassword: false,
  };
  const user = {
    id: "user1",
    fullName: "Aarav Sharma",
    email: "resident@example.test",
    role: "STUDENT",
    mustChangePassword: false,
  };
  const rooms = [
    {
      id: "room1",
      number: "203",
      capacity: 3,
      occupied: 2,
      vacant: 1,
      full: false,
    },
    {
      id: "room2",
      number: "204",
      capacity: 2,
      occupied: 2,
      vacant: 0,
      full: true,
    },
    {
      id: "room3",
      number: "205",
      capacity: 2,
      occupied: 0,
      vacant: 2,
      full: false,
    },
  ];
  const students = [
    {
      id: "resident1",
      name: "Aarav Sharma",
      email: user.email,
      mobile: "9876543210",
      room: { id: "room1", number: "203" },
      bedLabel: "B1",
      joiningDate: "2026-08-01",
      monthlyRentPaise: 850099,
      securityDepositPaise: 500000,
      rentDueDay: 5,
      status: "ACTIVE",
      mustChangePassword: false,
      notes: "",
    },
    {
      id: "resident2",
      name: "Meera Iyer",
      email: "meera@example.test",
      mobile: "9876543211",
      room: { id: "room1", number: "203" },
      bedLabel: "B2",
      joiningDate: "2026-07-01",
      monthlyRentPaise: 850000,
      securityDepositPaise: 500000,
      rentDueDay: 5,
      status: "ACTIVE",
      mustChangePassword: false,
    },
    {
      id: "resident3",
      name: "Kabir Patel",
      email: "kabir@example.test",
      mobile: "9876543212",
      room: { id: "room2", number: "204" },
      bedLabel: "B1",
      joiningDate: "2026-06-01",
      monthlyRentPaise: 900000,
      securityDepositPaise: 500000,
      rentDueDay: 5,
      status: "ACTIVE",
      mustChangePassword: true,
    },
    {
      id: "resident4",
      name: "Ishaan Singh",
      email: "ishaan@example.test",
      mobile: "9876543213",
      room: { id: "room2", number: "204" },
      bedLabel: "B2",
      joiningDate: "2026-06-01",
      monthlyRentPaise: 900000,
      securityDepositPaise: 500000,
      rentDueDay: 5,
      status: "ACTIVE",
      mustChangePassword: false,
    },
  ];
  const manualPayments = [];
  const control = {
    paidPaise: 0,
    paymentState: "CREATED",
    paid: false,
    qrDisabled: false,
    qrExpired: false,
    failStatus: false,
    capacityRejected: false,
    duplicateResident: false,
    failMutation: false,
    mustChangePassword: false,
    invalidSession: false,
    omitPayment: false,
    requestStatus:"PENDING",
    requests: [],
  };
  const payment = {
    id: "payment1",
    source: "RAZORPAY",
    method: "UPI",
    amountPaise: 850099,
    paidAt: new Date().toISOString(),
    providerOrderId: "qr_fixture1",
    providerPaymentId: "pay_fixture1",
    receiptNumber: "SH-TEST-1001",
    invoice: { id: "invoice1", ...current },
    student: { id: "resident1", name: "Aarav Sharma", room: "203" },
  };
  const historicPayment = {
    ...payment,
    id: "payment2",
    providerOrderId: "qr_fixture2",
    providerPaymentId: "pay_fixture2",
    receiptNumber: "SH-TEST-1000",
    amountPaise: 850000,
    student: { id: "resident2", name: "Meera Iyer", room: "203" },
  };
  const makeInvoice = (
    period = current,
    paid = control.paid,
    studentIndex = 0,
  ) => {
    const total = students[studentIndex]?.monthlyRentPaise || 850099;
    const credited = paid ? total : studentIndex === 0 ? control.paidPaise : 0;
    return {
      id: studentIndex === 0 ? "invoice1" : `invoice${studentIndex + 1}`,
      ...period,
      dueDate: `${period.year}-${String(period.month).padStart(2, "0")}-05T18:29:59.000Z`,
      status: paid ? "PAID" : "DUE",
      rentPaise: total,
      electricityPaise: 0,
      lateFeePaise: 0,
      otherChargesPaise: 0,
      discountPaise: 0,
      totalPaise: total,
      paidPaise: credited,
      remainingPaise: total - credited,
    };
  };
  const campaigns = [
    {
      id: "campaign1",
      title: "Your November rent reminder",
      body: "Hi {{name}}, your rent is due. Check your invoice in SafeHouse.",
      audienceType: "PENDING",
      scheduleType: "SCHEDULED",
      scheduleTimes: ["10:00", "18:00"],
      startDate: "2026-11-04",
      endDate: "2026-11-10",
      timezone: "Asia/Kolkata",
      status: "ACTIVE",
      financialYear: current.year,
      financialMonth: current.month,
      nextRunAt: new Date(Date.now() + 3600000).toISOString(),
      delivery: { sent: 2, failed: 0, skipped: 1, total: 3 },
    },
  ];
  const ok = (data, status = 200) => ({ status, data });
  const error = (status, code, message, details) =>
    ok({ error: { code, message, details } }, status);
  const handler = ({ url, method = "GET", body = {}, headers = {} }) => {
    const u = new URL(url, "https://safehouse-api.onrender.com");
    const path = u.pathname;
    control.requests.push({
      path,
      method,
      propertyId: headers["x-property-id"] || headers["X-Property-Id"],
      body: { ...body, password: undefined, tempPassword: undefined },
    });
    if(path.includes('/resident-requests')){
      const request={id:'request1',propertyId:'property1',propertyName:'Maple House',fullName:'Nisha Rao',email:'nisha@example.test',mobile:'+919876543219',status:control.requestStatus,createdAt:new Date().toISOString(),studentId:'resident1',membershipId:'resident-membership'};
      if(method==='GET')return ok({requests:[request]});
      if(body.password!=='FixturePass123!')return error(403,'PASSWORD_CONFIRMATION_FAILED','Your password did not match.');
      if(path.endsWith('/decision')){control.requestStatus=body.decision;return ok({request:{...request,status:control.requestStatus}});}
      if(path.endsWith('/rent')){
        if(control.capacityRejected)return error(409,'ROOM_FULL','This room has no vacant beds.');
        control.requestStatus='ACTIVE';return ok({ok:true,studentId:'resident1',membershipId:'resident-membership'});
      }
    }
    if(path.endsWith('/joined-residents'))return ok({members:[],records:[]});
    if(path.endsWith('/join-code'))return ok({code:'ABCD-EFGH-JKLM',enabled:true,revision:1});
    if (path === "/api/platform/auth/login") {
      const result=handler({url:"https://fixture.test/api/auth/login",method,body,headers});
      if(result.status===200)result.data={tokens:{...result.data.tokens,kind:"PLATFORM"}};
      return result;
    }
    if (path === "/api/platform/session") {
      const token=headers.authorization||headers.Authorization||"";
      const resident=token.includes("STUDENT"),actor=resident?{...user,mustChangePassword:control.mustChangePassword}:owner;
      const selected=token.includes("property2")?property2:property1;
      const memberships=(resident?[property1]:properties).map(p=>({id:`m-${p.id}`,role:resident?"RESIDENT":"OWNER",property:p,permissions:[],organisation:{id:"org-fixture",name:"Fixture PG",legacyAccess:true,entitled:true}}));
      return ok({account:{id:actor.id,email:actor.email,fullName:actor.fullName,credentialReady:true,emailVerified:true},memberships,
        membershipId:`m-${selected.id}`,property:selected,user:actor,student:resident?students[0]:null});
    }
    if (path === "/api/platform/workspace") return ok({tokens:{kind:"PLATFORM",accessToken:`fixture_OWNER_access_${body.membershipId}`,refreshToken:"fixture_OWNER_refresh_token"}});
    if (path === "/api/platform/logout") return ok({ok:true});
    if (path === "/api/platform/auth/change-password") {
      control.mustChangePassword=false;
      return ok({tokens:{kind:"PLATFORM",accessToken:"fixture_STUDENT_access",refreshToken:"fixture_STUDENT_refresh_token"}});
    }
    if (path === "/api/platform/refresh") return control.invalidSession?error(401,"SESSION_INVALID","Session invalid"):ok({tokens:{kind:"PLATFORM",accessToken:"fixture_OWNER_refreshed",refreshToken:"fixture_OWNER_refresh_token"}});
    if (path === "/api/auth/login") {
      if (body.password !== "FixturePass123!")
        return error(401, "INVALID_CREDENTIALS", "Invalid email or password");
      const account =
        body.email === user.email
          ? { ...user, mustChangePassword: control.mustChangePassword }
          : owner;
      return ok({
        user: account,
        tokens: {
          accessToken: `fixture_${account.role}_access`,
          refreshToken: `fixture_${account.role}_refresh_token`,
        },
        property: property1,
        properties: account.role === "OWNER" ? properties : undefined,
        student: account.role === "STUDENT" ? students[0] : undefined,
      });
    }
    const token = headers.authorization || headers.Authorization || "";
    const role = token.includes("STUDENT") ? "STUDENT" : "OWNER";
    if (path === "/api/auth/refresh")
      return control.invalidSession
        ? error(401, "SESSION_INVALID", "Session is no longer valid")
        : ok({
            tokens: {
              accessToken: `fixture_${body.refreshToken?.includes("STUDENT") ? "STUDENT" : "OWNER"}_access`,
              refreshToken: body.refreshToken,
            },
          });
    if (control.invalidSession)
      return error(401, "SESSION_INVALID", "Session is no longer valid");
    if (role === "STUDENT" && path.startsWith("/api/owner/"))
      return error(403, "FORBIDDEN", "Owner access required");
    const property =
      (headers["x-property-id"] || headers["X-Property-Id"]) === "property2"
        ? property2
        : property1;
    const period = {
      year: Number(u.searchParams.get("year")) || current.year,
      month: Number(u.searchParams.get("month")) || current.month,
    };
    const inv = makeInvoice(period);
    const decorated = students.map((s, index) => ({
      ...s,
      periodInvoice: makeInvoice(
        period,
        index === 1 || (index === 0 && control.paid),
        index,
      ),
      currentInvoice: makeInvoice(
        period,
        index === 1 || (index === 0 && control.paid),
        index,
      ),
    }));
    const due = {
      ...inv,
      overdue: Date.parse(inv.dueDate) < Date.now(),
      student: {
        id: "resident1",
        name: "Aarav Sharma",
        room: "203",
        mobile: "9876543210",
      },
      whatsappUrl: "https://wa.me/919876543210?text=Fixture%20reminder",
    };
    const dues = decorated
      .filter((s) => s.currentInvoice.remainingPaise > 0)
      .map((s) => ({
        ...s.currentInvoice,
        overdue: Date.parse(s.currentInvoice.dueDate) < Date.now(),
        student: {
          id: s.id,
          name: s.name,
          mobile: s.mobile,
          room: s.room?.number || null,
        },
        whatsappUrl: `https://wa.me/91${s.mobile}?text=Fixture%20reminder`,
      }));
    if (path === "/api/auth/me")
      return ok({
        user: role === "OWNER" ? owner : user,
        property: property1,
        properties: role === "OWNER" ? properties : undefined,
        student: role === "STUDENT" ? students[0] : undefined,
      });
    if (path === "/api/auth/logout") return ok({ ok: true });
    if (path === "/api/auth/change-password") {
      control.mustChangePassword = false;
      return ok({
        ok: true,
        tokens: {
          accessToken: `fixture_${role}_access`,
          refreshToken: `fixture_${role}_refresh_token`,
        },
      });
    }
    if (path === "/api/owner/dashboard")
      return ok({
        property,
        period,
        metrics: {
          totalStudents: property.id === "property2" ? 0 : students.length,
          totalBeds: property.id === "property2" ? 0 : 7,
          occupiedBeds: property.id === "property2" ? 0 : 4,
          vacantBeds: property.id === "property2" ? 0 : 3,
          paidStudents: property.id === "property2" ? 0 : 1,
          pendingStudents: property.id === "property2" ? 0 : 3,
          overdueStudents: due.overdue ? 3 : 0,
          totalExpectedPaise:
            property.id === "property2"
              ? 0
              : students.reduce((sum, s) => sum + s.monthlyRentPaise, 0),
          totalCollectedPaise: property.id === "property2" ? 0 : 850000,
          pendingTotalPaise:
            property.id === "property2"
              ? 0
              : students.reduce((sum, s) => sum + s.monthlyRentPaise, 0) -
                850000,
          collectionRate: property.id === "property2" ? 0 : 24.3,
        },
        pendingDues: property.id === "property2" ? [] : dues,
        recentPayments: property.id === "property2" ? [] : [historicPayment],
      });
    if (path === "/api/owner/properties") {
      if (method === "POST") {
        const p = {
          ...property1,
          id: `property${properties.length + 1}`,
          name: body.name,
          timezone: body.timezone,
        };
        properties.push(p);
        return ok({ property: p }, 201);
      }
      return ok({ properties });
    }
    if (path === "/api/owner/property") {
      if (method === "PATCH") Object.assign(property, body);
      return ok({ property });
    }
    if (path === "/api/owner/rooms") {
      if (method === "POST") {
        if (rooms.some((r) => r.number === body.number))
          return error(409, "ROOM_EXISTS", "This room already exists");
        const r = {
          id: `room${rooms.length + 1}`,
          number: body.number,
          capacity: body.capacity,
          occupied: 0,
          vacant: body.capacity,
          full: false,
        };
        rooms.push(r);
        return ok({ room: r }, 201);
      }
      return ok({ rooms: property.id === "property2" ? [] : rooms });
    }
    if (/^\/api\/owner\/rooms\//.test(path)) {
      const r = rooms.find((r) => r.id === path.split("/").at(-1));
      if (body.capacity < r.occupied)
        return error(
          400,
          "CAPACITY_TOO_SMALL",
          "Capacity cannot be less than current occupancy",
        );
      Object.assign(r, body);
      return ok({ room: r });
    }
    if (path === "/api/owner/students") {
      if (method === "POST") {
        if (control.capacityRejected || body.roomId === "room2")
          return error(409, "ROOM_FULL", "This room has no vacant beds", {
            fieldErrors: { roomId: ["Room is full. Choose another room."] },
          });
        if (
          control.duplicateResident ||
          students.some(
            (s) => s.email === body.email || s.mobile === body.mobile,
          )
        )
          return error(
            409,
            "STUDENT_ALREADY_EXISTS",
            "A student with this email or mobile number already exists",
          );
        const s = {
          ...students[0],
          id: `resident${students.length + 1}`,
          name: body.fullName,
          email: body.email,
          mobile: body.mobile,
          room: body.roomId
            ? {
                id: body.roomId,
                number: rooms.find((r) => r.id === body.roomId)?.number,
              }
            : null,
          bedLabel: body.bedLabel,
          monthlyRentPaise: Math.round(body.monthlyRent * 100),
          securityDepositPaise: Math.round(body.securityDeposit * 100),
          rentDueDay: body.rentDueDay,
          joiningDate: body.joiningDate,
          notes: body.notes,
          mustChangePassword: true,
        };
        students.push(s);
        return ok({ property, period, student: s }, 201);
      }
      const q = (u.searchParams.get("q") || "").toLowerCase(),
        status = u.searchParams.get("status") || "ALL";
      return ok({
        property,
        period,
        students:
          property.id === "property2"
            ? []
            : decorated.filter(
                (s) =>
                  `${s.name} ${s.mobile} ${s.room?.number}`
                    .toLowerCase()
                    .includes(q) &&
                  (status === "PAID"
                    ? s.currentInvoice.status === "PAID"
                    : ["PENDING", "OVERDUE"].includes(status)
                      ? s.currentInvoice.status !== "PAID"
                      : true),
              ),
      });
    }
    if (/^\/api\/owner\/students\/[^/]+\/reset-password$/.test(path))
      return ok({ ok: true });
    if (/^\/api\/owner\/students\/[^/]+$/.test(path)) {
      const s = students.find((s) => s.id === path.split("/").at(-1));
      if (!s) return error(404, "STUDENT_NOT_FOUND", "Student not found");
      if (method === "PATCH") {
        Object.assign(s, {
          ...body,
          name: body.fullName,
          monthlyRentPaise: Math.round(body.monthlyRent * 100),
          securityDepositPaise: Math.round(body.securityDeposit * 100),
          room: body.roomId
            ? {
                id: body.roomId,
                number: rooms.find((r) => r.id === body.roomId)?.number,
              }
            : null,
        });
        return ok({
          property,
          period,
          student: s,
          rentChange: {
            appliedToSelectedInvoice: true,
            effectiveYear: period.year,
            effectiveMonth: period.month,
          },
        });
      }
      return ok({
        property,
        period,
        periodInvoice: inv,
        student: {
          ...s,
          invoices: [
            {
              ...inv,
              payments: [
                ...manualPayments,
                ...(control.paid && control.paymentState === "CAPTURED"
                  ? [payment]
                  : []),
              ],
            },
          ],
          rentRevisions: [
            {
              id: "revision1",
              amountPaise: s.monthlyRentPaise,
              effectiveYear: current.year,
              effectiveMonth: current.month,
            },
          ],
        },
      });
    }
    if (path === "/api/owner/dues")
      return ok({
        property,
        period,
        dues: property.id === "property2" ? [] : dues,
        totalDuePaise:
          property.id === "property2"
            ? 0
            : dues.reduce((sum, i) => sum + i.remainingPaise, 0),
        overdueCount:
          property.id === "property2"
            ? 0
            : dues.filter((i) => i.overdue).length,
      });
    if (path === "/api/owner/payments")
      return ok({
        property,
        period,
        payments:
          property.id === "property2"
            ? []
            : [
                ...manualPayments,
                ...(control.paid && control.paymentState === "CAPTURED"
                  ? [payment]
                  : []),
                historicPayment,
              ],
      });
    if (path.endsWith("/manual-payment")) {
      const amountPaise = Math.round(body.amount * 100);
      control.paidPaise += amountPaise;
      control.paid = control.paidPaise >= 850099;
      const manual = {
        ...payment,
        id: "manual" + (manualPayments.length + 1),
        receiptNumber: "SH-TEST-MANUAL-" + (manualPayments.length + 1),
        source: "MANUAL",
        method: body.method,
        amountPaise,
        providerOrderId: null,
        providerPaymentId: null,
      };
      manualPayments.push(manual);
      return ok({ payment: manual }, 201);
    }
    if (/^\/api\/owner\/invoices\//.test(path)) return ok({ invoice: inv });
    if (path === "/api/student/dashboard")
      return ok({
        student: students[0],
        currentInvoice: makeInvoice(),
        recentPayments: [
          ...manualPayments,
          ...(control.paid && control.paymentState === "CAPTURED"
            ? [payment]
            : []),
        ],
      });
    if (path === "/api/student/invoices")
      return ok({
        invoices: [
          {
            ...makeInvoice(),
            payments: [
              ...manualPayments,
              ...(control.paid &&
              control.paymentState === "CAPTURED" &&
              !control.omitPayment
                ? [payment]
                : []),
            ],
          },
        ],
      });
    if (path === "/api/student/payments/upi-qr")
      return control.qrDisabled
        ? error(503, "UPI_QR_NOT_ENABLED", "Secure UPI QR is not activated")
        : ok(
            {
              qr: {
                id: "qr_fixture1",
                amountPaise: makeInvoice().remainingPaise,
                imageUrl: "https://rzp.io/i/fixture",
                expiresAt:
                  Math.floor(Date.now() / 1000) +
                  (control.qrExpired ? -60 : 600),
              },
              status: "AWAITING_PAYMENT",
            },
            201,
          );
    if (path.endsWith("/status")) {
      if (control.failStatus)
        return error(
          503,
          "QR_STATUS_UNAVAILABLE",
          "Payment confirmation unavailable",
        );
      if (control.paymentState === "CAPTURED") control.paid = true;
      return ok({
        attemptStatus: control.paymentState,
        invoiceStatus: control.paid ? "PAID" : "DUE",
        paid: control.paid,
        invoice: makeInvoice(),
      });
    }
    if (path.endsWith("/receipt.pdf"))
      return {
        status: 200,
        data: "%PDF-1.4\n% controlled test receipt",
        contentType: "application/pdf",
      };
    if (path === "/api/notifications/config")
      return ok({
        clientEnabled: true,
        serverEnabled: true,
        firebase: {
          projectId: "fixture",
          applicationId: "fixture",
          apiKey: "fixture-public",
          senderId: "fixture",
        },
      });
    if (path.startsWith("/api/notifications/devices/")) return ok({ ok: true });
    if (path === "/api/owner/notifications/campaigns" && method === "GET")
      return ok({
        property,
        campaigns,
        limits: {
          maxPerDay: 3,
          quietHours: "08:00–22:00",
          maxCampaignDays: 30,
        },
      });
    if (path === "/api/owner/notifications/send-now")
      return ok({ campaignId: "sent1", sent: 2, failed: 0, skipped: 1 }, 201);
    if (path === "/api/owner/notifications/campaigns" && method === "POST")
      return ok({ campaign: { id: "new1", ...body, status: "ACTIVE" } }, 201);
    if (/\/notifications\/campaigns\//.test(path)) {
      const c = campaigns.find((c) => c.id === path.split("/").at(-1));
      c.status =
        body.action === "PAUSE"
          ? "PAUSED"
          : body.action === "RESUME"
            ? "ACTIVE"
            : "CANCELLED";
      return ok({ campaign: c });
    }
    return error(404, "NOT_FOUND", "Fixture route not found");
  };
  return { handler, control, current, properties, students, rooms };
}
