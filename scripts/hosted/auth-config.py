# Set the hosted project's Supabase Auth settings that live in the repo (docs/09 §12, README › Auth emails):
# the site URL, the minimum password length, secure email change, the subject and HTML of each auth email
# (supabase/templates/*.html, subjects from supabase/config.toml [auth.email.template.*]; each must link to our
# /auth/confirm with the token hash, TEMPLATE_LINKS below) and the security alerts for
# a changed password or email address ([auth.email.notification.*]: on, subject and HTML, which must name the Forgot
# password link and the support address).
#
#   python3 scripts/hosted/auth-config.py --dry-run   # print what would change, change nothing
#   python3 scripts/hosted/auth-config.py             # apply
#
# Uses the Management API (GET and PATCH /v1/projects/{ref}/config/auth). The session's network proxy adds the real
# access token; "dummy" is a placeholder. It never sets SMTP settings or credentials: the owner sets those in the
# dashboard. Override the project with SUPABASE_PROJECT_REF.
import json, os, subprocess, sys, tomllib

sys.path.insert(0, os.path.dirname(__file__))
from _api import REF

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
URL = f"https://api.supabase.com/v1/projects/{REF}/config/auth"

# Keptrow on www.keptrow.com (docs/14). Run only after the DNS, Vercel and Brevo steps there, with SMTP configured:
# the site URL is where every auth email's links point. Keep the klarert.com redirect URLs in the allow list meanwhile.
SITE_URL = "https://www.keptrow.com"
MIN_PASSWORD = 12  # src/lib/passwords.ts MIN_PASSWORD
# config.toml template name -> Management API key part, and the link each must carry. The links go to our own
# /auth/confirm with the token hash: a page with a Continue button, whose click posts to /auth/callback, which opens
# the session with verifyOtp. So a link scanner that opens every link in an email (Microsoft Defender Safe Links) does
# not use up the one-time token, the links work on any device, and they never show the Supabase project's address.
# Supabase's {{ .ConfirmationURL }} (its verify step and a PKCE code that only the asking browser can use) is
# refused, and so is a link straight to /auth/callback (a scanner's GET would use the token up). `type` is what
# verifyOtp takes in supabase-js 2.119 / GoTrue 2.197:
# "email" for sign-up and sign-in links ("signup" and "magiclink" are the deprecated names), "recovery", "email_change".
# `redirect_to` carries the page the app asked for (src/lib/auth-links.ts emailLinkNext). Docs/09 §12.
CONFIRM = "{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type="
TEMPLATE_LINKS = {
    "confirmation": CONFIRM + "email&amp;redirect_to={{ .RedirectTo }}",
    "magic_link": CONFIRM + "email&amp;redirect_to={{ .RedirectTo }}",
    "recovery": CONFIRM + "recovery&amp;next=/login/new-password&amp;redirect_to={{ .RedirectTo }}",
    "email_change": CONFIRM + "email_change&amp;next=/account&amp;redirect_to={{ .RedirectTo }}",
}
TEMPLATES = list(TEMPLATE_LINKS)
# config.toml notification name -> Management API key part (mailer_notifications_<n>_enabled,
# mailer_subjects_<n>_notification, mailer_templates_<n>_notification_content; checked 16 Nov 2026 against the keys
# Supabase CLI 3.1.0 sends to this endpoint)
NOTIFICATIONS = ["password_changed", "email_changed"]
FORGOT_PASSWORD_LINK = "{{ .SiteURL }}/login/forgot-password"
SUPPORT_ADDRESS = "support@keptrow.com"  # "If this was not you, contact support@keptrow.com straight away."


def api(method, body=None):
    args = ["curl", "-sS", "-w", "\n%{http_code}", "-X", method, URL, "-H", "Authorization: Bearer dummy"]
    if body is not None:
        args += ["-H", "Content-Type: application/json", "--data-binary", "@-"]
    out = subprocess.run(args, input=json.dumps(body) if body is not None else None,
                         capture_output=True, text=True).stdout
    text, code = out.rsplit("\n", 1)
    if code not in ("200", "201"):
        sys.exit(f"{method} config/auth: HTTP {code}: {text[:800]}")
    return json.loads(text) if text else None


def desired():
    with open(os.path.join(ROOT, "supabase", "config.toml"), "rb") as f:
        config = tomllib.load(f)
    templates = config["auth"]["email"]["template"]
    want = {
        "site_url": SITE_URL,
        "password_min_length": MIN_PASSWORD,
        # both the old and the new address confirm an email change (needs "Confirm email" on too)
        "mailer_secure_email_change_enabled": True,
    }
    for name in TEMPLATES:
        t = templates[name]
        path = os.path.normpath(os.path.join(ROOT, t["content_path"]))
        with open(path, encoding="utf-8") as f:
            html = f.read()
        if "{{ .ConfirmationURL }}" in html:
            sys.exit(f"{path}: links to Supabase's verify step ({{{{ .ConfirmationURL }}}}), not to /auth/confirm")
        if "/auth/callback?token_hash=" in html:
            sys.exit(f"{path}: links straight to /auth/callback, which a link scanner's GET would use up; link to /auth/confirm")
        if html.count(f'href="{TEMPLATE_LINKS[name]}"') != 1:
            sys.exit(f"{path}: no link {TEMPLATE_LINKS[name]}")
        want[f"mailer_subjects_{name}"] = t["subject"]
        want[f"mailer_templates_{name}_content"] = html
    notifications = config["auth"]["email"]["notification"]
    for name in NOTIFICATIONS:
        n = notifications[name]
        if n.get("enabled") is not True:
            sys.exit(f"config.toml [auth.email.notification.{name}]: not enabled")
        path = os.path.normpath(os.path.join(ROOT, n["content_path"]))
        with open(path, encoding="utf-8") as f:
            html = f.read()
        if FORGOT_PASSWORD_LINK not in html:
            sys.exit(f"{path}: no {FORGOT_PASSWORD_LINK} link")
        if SUPPORT_ADDRESS not in html:
            sys.exit(f"{path}: no {SUPPORT_ADDRESS}")
        want[f"mailer_notifications_{name}_enabled"] = True
        want[f"mailer_subjects_{name}_notification"] = n["subject"]
        want[f"mailer_templates_{name}_notification_content"] = html
    return want


def show(value):
    if isinstance(value, str) and ("\n" in value or len(value) > 80):
        return f"<{len(value)} characters>"
    return json.dumps(value)


def main():
    dry = "--dry-run" in sys.argv[1:]
    unknown = [a for a in sys.argv[1:] if a != "--dry-run"]
    if unknown:
        sys.exit(f"unknown arguments: {' '.join(unknown)}")
    want = desired()
    have = api("GET")
    changes = {k: v for k, v in want.items() if have.get(k) != v}
    for k in sorted(want):
        mark = "change" if k in changes else "same  "
        line = f"{mark} {k}: {show(have.get(k))}"
        if k in changes:
            line += f" -> {show(want[k])}"
        print(line)
    # settings this script leaves alone but the auth emails depend on (docs/09 §12)
    print("\nalso check (not changed here):")
    for k in ["mailer_autoconfirm", "mailer_otp_exp", "uri_allow_list", "smtp_host", "smtp_sender_name",
              "smtp_admin_email", "rate_limit_email_sent", "security_update_password_require_reauthentication"]:
        print(f"  {k}: {show(have.get(k))}")
    if not changes:
        print("\nnothing to change")
        return
    if dry:
        print(f"\ndry run: {len(changes)} keys would change")
        return
    api("PATCH", changes)
    print(f"\npatched {len(changes)} keys")


if __name__ == "__main__":
    main()
