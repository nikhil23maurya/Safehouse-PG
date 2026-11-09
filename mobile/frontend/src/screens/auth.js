import { brand } from "../components/icons.js";
import { button, heading, notice } from "../components/ui.js";
import { field, formValues } from "../components/forms.js";

export function loginScreen(ctx) {
  return {
    bare: true,
    title: "Sign in",
    content: `<main class="login-page royal-page"><div class="login-inner"><div class="login-identity">${brand()}</div><div class="login-heading"><span class="royal-kicker">YOUR PG. YOUR PEACE OF MIND.</span><h1>Welcome back.</h1><span class="gold-rule"></span><p>Sign in to your PGOne account.<br>Everything you need, right where you left it.</p></div><form data-form="login" novalidate><div class="form-error" role="alert"></div>${field("email", "Email address", { type: "email", required: true, placeholder: "you@example.com", attrs: 'autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false" enterkeyhint="next"' })}${field("password", "Password", { type: "password", required: true, placeholder: "Enter your password", attrs: 'autocomplete="current-password" maxlength="128" enterkeyhint="go"' })}${button("Sign in", { type: "submit", kind: "primary block", glyph: "arrow" })}</form>${button("Continue with mobile number", { route: "phone", params: { mode: "SIGN_IN" }, kind: "secondary block login-phone-link" })}<div class="login-support"><span>New here? Set up or join your PG with your mobile number.</span></div></div><span class="login-footer">Your home, managed simply.</span></main>`,
    async submit(name, form) {
      if (name !== "login") return;
      const values = formValues(form);
      await ctx.signIn(values.email.trim(), values.password);
    },
  };
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
      `<form data-form="password" novalidate>${notice("Use at least 8 characters. A mix of letters, numbers and symbols is recommended.")}<div class="card"><div class="form-error" role="alert"></div>${field("currentPassword", "Current password", { type: "password", required: true, attrs: 'autocomplete="current-password" maxlength="128"' })}${field("newPassword", "New password", { type: "password", required: true, attrs: 'autocomplete="new-password" minlength="8" maxlength="128"' })}${field("confirmPassword", "Confirm new password", { type: "password", required: true, attrs: 'autocomplete="new-password" minlength="8" maxlength="128"' })}${button("Update password", { type: "submit", kind: "primary block" })}</div></form>`,
    async submit(name, form) {
      if (name !== "password") return;
      const values = formValues(form);
      if (values.newPassword !== values.confirmPassword)
        throw new Error("The new passwords don’t match.");
      const result = await ctx.api("/api/auth/change-password", {
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
