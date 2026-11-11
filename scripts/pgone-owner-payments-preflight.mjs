import "dotenv/config";
import {ownerPaymentConfig} from "../src/platform/owner-payments/config.ts";
const c=ownerPaymentConfig();
console.log("PGONE_OWNER_PAYMENTS_PREFLIGHT",JSON.stringify({configurationValid:c.configurationValid,configurationAvailable:c.configured,enabled:c.enabled,mode:c.RAZORPAY_OWNER_MODE,ledgerAllowed:c.ledgerAllowed,requestedScope:"read_write",feeMerchantExcluded:Boolean(c.PGONE_SUBSCRIPTION_MERCHANT_ACCOUNT_ID),credentialsIndependent:true,liveProviderVerified:false,note:"Read-only local configuration check. No token exchange, account, order or payment was created. Flags do not establish Razorpay partner approval."}));
