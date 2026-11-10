import { brand } from "../components/icons.js";
import { button, heading, notice } from "../components/ui.js";
import { field, formValues } from "../components/forms.js";

const accountPage = (title,description,body) => ({bare:true,title,
  content:`<main class="login-page royal-page"><div class="login-inner"><div class="login-identity">${brand()}</div><div class="login-heading"><span class="royal-kicker">YOUR PG. BEAUTIFULLY MANAGED.</span><h1>${title}</h1><span class="gold-rule"></span><p>${description}</p></div>${body}</div><span class="login-footer">Your home, managed simply.</span></main>`});
const emailField = () => field("email","Email address",{type:"email",required:true,placeholder:"you@example.com",attrs:'autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false" maxlength="254"'});
const passwordField = (name,label,current=false) => field(name,label,{type:"password",required:true,
  help:current?"":"Use 12–128 characters. A longer, unique password is best.",
  attrs:`autocomplete="${current?"current-password":"new-password"}" ${current?"":'minlength="12"'} maxlength="128"`});
const accountForm = (name,fields,label) => `<form data-form="${name}" novalidate><div class="form-error" role="alert"></div>${fields}${button(label,{type:"submit",kind:"primary block",glyph:"arrow"})}</form>`;
const legalLinks = () => `<p class="legal-copy">By creating an account, you agree to our <button class="text-button" data-route="legal" data-params='{"kind":"terms"}'>Terms</button> and <button class="text-button" data-route="legal" data-params='{"kind":"privacy"}'>Privacy Policy</button>.</p>`;
export function loginScreen(ctx) {
  return {...accountPage("Welcome back.","Sign in to your PGOne account.",
    accountForm("login",emailField()+passwordField("password","Password",true),"Sign in")+
    button("Forgot password?",{route:"forgotPassword",kind:"text-button block"})+
    button("New to PGOne? Create account",{route:"signup",kind:"secondary block"})),
    title:"Sign in",
    async submit(name,form){if(name!=="login")return;const v=formValues(form);await ctx.signIn(v.email.trim(),v.password);}};
}
export function signupScreen(ctx) {
  return {...accountPage("Create your account.","One account for your PG, your people and your everyday work.",
    accountForm("signup",emailField()+passwordField("password","Password")+passwordField("confirmPassword","Confirm password"),"Create account")+
    button("Already have an account? Sign in",{route:"login",kind:"secondary block"})+legalLinks()),
    async submit(name,form){if(name!=="signup")return;const v=formValues(form);if(v.password!==v.confirmPassword)throw new Error("Passwords do not match.");
      const result=await ctx.api("/api/platform/auth/register",{method:"POST",public:true,body:{email:v.email.trim(),password:v.password}});
      ctx.markSaved();await ctx.acceptPlatform(result.tokens);}};
}
export function forgotPasswordScreen(ctx) {
  return {...accountPage("Reset your password.","We’ll email a secure link that expires in 15 minutes.",
    accountForm("forgotPassword",emailField(),"Send recovery link")+button("Back to sign in",{route:"login",kind:"secondary block"})+
    `<div data-recovery-status role="status"></div><p class="legal-copy">Historical phone-only accounts without email credentials require assisted ownership recovery.</p>`),
    async submit(name,form){if(name!=="forgotPassword")return;const v=formValues(form);
      const result=await ctx.api("/api/platform/auth/forgot-password",{method:"POST",public:true,body:{email:v.email.trim()}});
      document.querySelector("[data-recovery-status]").textContent=result.message;}};
}
export function enrolEmailScreen(ctx) {
  return {...accountPage("Secure your email sign-in.","You’re signed in to an existing account. Confirm an email and choose a password to keep these records accessible.",
    accountForm("enrolEmail",emailField()+passwordField("password","Password")+passwordField("confirmPassword","Confirm password"),"Email confirmation link")+
    `<p data-enrol-status role="status"></p>`+button("Sign out",{action:"logout",kind:"secondary block"})),
    async submit(name,form){if(name!=="enrolEmail")return;const v=formValues(form);if(v.password!==v.confirmPassword)throw new Error("Passwords do not match.");
      await ctx.api("/api/platform/auth/enrol-email",{method:"POST",body:{email:v.email.trim(),password:v.password}});
      document.querySelector("[data-enrol-status]").textContent="Check your email to confirm ownership. Then sign in with your email and password.";}};
}

export function passwordScreen(ctx) {
  const required = ctx.snapshot.user.mustChangePassword;
  return {
    title: "Change password",
    nav: false,
    back: !required,
    headerAction: required
      ? button("Sign out", { action: "logout", kind: "secondary" })
      : "",
    content:
      heading(
        "ACCOUNT SECURITY",
        required ? "Make it your own." : "A fresh password.",
        required
          ? "Replace your temporary password to continue."
          : "Choose a strong password you haven’t used before.",
      ) +
      `<form data-form="password" novalidate>${notice("Use at least 12 characters. A mix of letters, numbers and symbols is recommended.")}<div class="card"><div class="form-error" role="alert"></div>${field("currentPassword", "Current password", { type: "password", required: true, attrs: 'autocomplete="current-password" maxlength="128"' })}${field("newPassword", "New password", { type: "password", required: true, attrs: 'autocomplete="new-password" minlength="12" maxlength="128"' })}${field("confirmPassword", "Confirm new password", { type: "password", required: true, attrs: 'autocomplete="new-password" minlength="12" maxlength="128"' })}${button("Update password", { type: "submit", kind: "primary block" })}</div></form>`,
    async submit(name, form) {
      if (name !== "password") return;
      const values = formValues(form);
      if (values.newPassword !== values.confirmPassword)
        throw new Error("The new passwords don’t match.");
      const result = await ctx.api(ctx.snapshot.tokens?.kind === "PLATFORM" ? "/api/platform/auth/change-password" : "/api/auth/change-password", {
        method: "POST",
        body: {
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        },
      });
      await ctx.updatePasswordSession(result.tokens);
      ctx.toast("Password updated.");
    },
  };
}
