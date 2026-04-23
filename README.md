# hydrooj-oauth-dlufl

A HydroOJ plugin that integrates a Neusoft-style university CAS system as the primary authentication method, with additional policy controls for login, sudo confirmation, account security, and logout behavior.

This plugin was originally written for DLUFL-CAS, but the overall design should also work for other university CAS deployments provided by Neusoft, as long as the target CAS server uses a compatible flow and response format.

This plugin is particularly suitable for servers that serve both external networks (which can access the internet and CAS authentication servers) and internal networks (which cannot access any servers other than OJ, including CAS authentication servers) due to various reasons such as confidentiality and examination purposes.

Please note that this plugin behaves differently in an internal network compared to a regular CAS server. Since the Neusoft CAS system does not provide relevant interfaces, this plugin crawls and simulates sending login requests by mimicking requests to authenticate the credentials submitted by users. Additionally, the system encrypts the submitted username and password (with keys pre-set in the system as 1, 2, and 3).

## Features

This plugin provides the following functionality:

- Adds a CAS OAuth provider to HydroOJ.
- Supports both external-network and internal-network login flows.
- For internal networks, provides a local login page that performs CAS authentication without directly opening the remote CAS page.
- Automatically validates CAS tickets and binds CAS identities to existing HydroOJ users.
- Restricts non-admin users to CAS-only login:
  - password login is disabled
  - WebAuthn login is disabled
  - self-registration is disabled
  - password reset / lost password is disabled
  - only the configured CAS OAuth provider is allowed
- Adds CAS-based sudo confirmation for users logged in through CAS.
- Disables non-CAS sudo methods for non-admin users.
- Restricts non-admin users from changing sensitive security settings:
  - changing password
  - changing email
  - enabling two-factor authentication
  - adding WebAuthn / passkey authenticators
- Adjusts logout behavior:
  - external CAS sessions can be redirected to CAS logout
  - internal-network logout avoids redirecting to an unreachable external CAS logout page

## Intended Use

This plugin is intended for deployments where:

- a university or institution already has a working CAS server
- HydroOJ accounts already exist or are imported in advance
- users should authenticate through CAS instead of local HydroOJ credentials
- non-admin users should have a more locked-down security model

This plugin is not a general-purpose user provisioning system. It assumes that the corresponding HydroOJ users already exist and can be matched by account fields such as student/staff ID.

## Installation

Clone this repository to a location on the server:

```bash
git clone <repo_url> <path_to_folder>
```

Enable the addon in HydroOJ:

```bash
hydrooj addon add <path_to_folder>
```

Restart HydroOJ:

```bash
pm2 restart hydrooj
```

Check the logs:

```bash
pm2 logs hydrooj
```

If there are no plugin load errors, the addon is loaded successfully.

## Configuration

After logging in with an administrator account in the web interface, go to:

**System** → **System Configurations**

Then find the configuration section for:

**hydrooj-oauth-dlufl**

From there, you can view and modify settings such as:

- CAS server URL and paths
- OAuth callback path
- internal token/submit routes
- logout behavior
- sudo-related routes
- internal login template name
- internal network CIDR ranges
- required CAS fields
- email domain mapping
- timeout values

## Typical Deployment Notes

For a typical existing CAS deployment, you usually need to configure at least:

- `casServerUrl`
- `casLoginPath`
- `casLogoutPath`
- `casValidatePath`
- `oauthCallbackPath`
- `intranetCidrs`
- `requiredCasFields`

You should also verify that the CAS validation response contains the fields expected by this plugin, especially:

- `user_id`
- `unit_name`
- `id_number`
- `user_name`
- `id_type`

If your CAS response format differs, you may need to adjust the field mapping logic in the source code.

## User Binding Behavior

The plugin does not automatically create HydroOJ users for new CAS accounts by default.

Instead, it tries to bind a CAS identity to an existing HydroOJ account by looking up the user with values derived from CAS attributes, primarily `id_number`.

If no matching HydroOJ user exists, login will be rejected.

## Internal Network Login

When a client IP is inside the configured `intranetCidrs`, the plugin can render a local login page instead of redirecting the browser directly to the CAS website.

This is useful in environments where:

- the internal network cannot directly access the public CAS login page
- the institution wants a smoother login experience inside campus networks
- sudo confirmation should use the same internal authentication page

## Notes on Sudo and Security Policies

This plugin extends HydroOJ’s sudo flow for CAS users.

For CAS-authenticated non-admin users:

- sudo confirmation is expected to go through CAS
- password/WebAuthn/TOTP-based sudo confirmation is blocked
- several account security operations are blocked in the security settings page

Administrators are intentionally exempted from these restrictions.

## Compatibility

This plugin is designed for HydroOJ and for CAS systems with a flow similar to Neusoft-provided campus CAS deployments.

Because different schools may customize their CAS deployment, some environments may require small code changes, especially around:

- CAS attribute names
- XML namespaces / validation response format
- login form parameters
- internal-network routing assumptions

## Development Reference

For more information about HydroOJ plugin development, see:

[https://docs.hydro.ac/zh/docs/Hydro/plugins](https://docs.hydro.ac/zh/docs/Hydro/plugins)

## Disclaimer

This repository is intended for administrators who already have an operational CAS environment and want to integrate it into HydroOJ with stricter authentication and account-security policies.

Before deploying to production, test carefully in your own environment, especially:

- CAS login flow
- account binding behavior
- internal network detection
- sudo confirmation flow
- logout flow
- security-setting restrictions

## License

This project is licensed under the GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later).
