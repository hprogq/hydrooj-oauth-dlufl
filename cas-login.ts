import axios, { AxiosError, AxiosResponse } from "axios";
import setCookie from "set-cookie-parser";
import * as cheerio from "cheerio";
import { strEnc } from "./des";
import xml2js from "xml2js";

/** ==== Config ==== */
const casBase = "https://cas.dlufl.edu.cn/cas";
const callbackUrl = "https://i.dlufl.edu.cn/dcp/";
const requestHeaders = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Content-Type": "application/x-www-form-urlencoded",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

export interface Service {
  url: string;
}

export interface Token {
  cookie: string;
}

export type Result<T> =
  | { success: true; data: T; message?: string; extra?: any }
  | { success: false; message: string; code?: string; extra?: any };

interface AttributeObject {
  [key: string]: string;
}

interface LoginData {
  token: Token;
  ticket: string;
  userInfo: AttributeObject;
  extra: { alias: string; uuid: string };
}

function toErrMsg(e: unknown, fallback = "Request failed"): string {
  if (axios.isAxiosError(e)) {
    const ae = e as AxiosError;
    if (ae.response) {
      return `${fallback} (HTTP ${ae.response.status})`;
    }
    if (ae.request) {
      return `${fallback} (no response)`;
    }
    return `${fallback}: ${ae.message}`;
  }
  if (e instanceof Error) return `${fallback}: ${e.message}`;
  return fallback;
}

function buildCookieString(fromSetCookieHeader?: string[] | string): string {
  if (!fromSetCookieHeader) return "";
  const parsed = setCookie.parse(fromSetCookieHeader as any);
  return parsed.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function getToken(
  username: string,
  password: string,
  serviceUrl = callbackUrl,
): Promise<Result<Token>> {
  try {
    const initResponse: AxiosResponse = await axios.get(
      `${casBase}/login?service=${encodeURIComponent(
        serviceUrl,
      )}&renew=true&_=${Date.now()}`,
      { headers: requestHeaders, timeout: 15000 },
    );

    const initSetCookieHeader = initResponse.headers["set-cookie"];
    if (!initSetCookieHeader) {
      return { success: false, message: "Remote server error: no Set-Cookie." };
    }

    const initCookies = setCookie.parse(initSetCookieHeader);
    const hasSession = initCookies.some((c) =>
      c.name.startsWith("JSESSIONIDCAS"),
    );
    if (!hasSession) {
      return { success: false, message: "Remote server error: no session." };
    }

    const cookieString = buildCookieString(initSetCookieHeader);
    const $init = cheerio.load(initResponse.data);
    const ticket = ($init("#lt").val() as string) || "";
    const execution = ($init('input[name="execution"]').val() as string) || "";
    if (!ticket || !execution) {
      return {
        success: false,
        message: "Remote server error: no lt/execution.",
      };
    }

    const rsa = strEnc(`${username}${password}${ticket}`, "1", "2", "3");

    const loginResponse: AxiosResponse = await axios.post(
      `${casBase}/login?service=${encodeURIComponent(serviceUrl)}`,
      new URLSearchParams({
        rsa,
        ul: String(username.length),
        pl: String(password.length),
        lt: ticket,
        execution,
        _eventId: "submit",
      }).toString(),
      {
        headers: { ...requestHeaders, Cookie: cookieString },
        maxRedirects: 0,
        validateStatus: (s) => s >= 200 && s < 400,
        timeout: 15000,
      },
    );

    const loginSetCookieHeader = loginResponse.headers["set-cookie"];
    if (!loginSetCookieHeader) {
      try {
        const $login = cheerio.load(loginResponse.data);
        const loginErrorMsg = $login("#errormsghide").text()?.trim();
        if (loginErrorMsg) {
          return { success: false, message: loginErrorMsg };
        }
      } catch {}
      return { success: false, message: "Login failed: no cookies returned." };
    }

    const parsedLoginCookies = setCookie.parse(loginSetCookieHeader);
    const hasTgc = parsedLoginCookies.some((c) => c.name.startsWith("CASTGC"));
    if (!hasTgc) {
      try {
        const $login = cheerio.load(loginResponse.data);
        const loginErrorMsg = $login("#errormsghide").text()?.trim();
        if (loginErrorMsg) {
          return { success: false, message: loginErrorMsg };
        }
      } catch {}
      return { success: false, message: "Login failed: no CASTGC cookie." };
    }

    const cookie = parsedLoginCookies
      .filter((c) => c.name !== "Language")
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    return { success: true, data: { cookie } };
  } catch (e) {
    return { success: false, message: toErrMsg(e, "Login request failed") };
  }
}

export async function getTicket(
  token: Token,
  service: Service,
): Promise<Result<{ ticket: string }>> {
  try {
    const resp: AxiosResponse = await axios.get(
      `${casBase}/login?service=${encodeURIComponent(service.url)}`,
      {
        headers: { ...requestHeaders, Cookie: token.cookie },
        maxRedirects: 0,
        validateStatus: (s) => s >= 200 && s < 400,
        timeout: 15000,
      },
    );

    const location = resp.headers["location"];
    if (!location) {
      return { success: false, message: "Authorization failed: no redirect." };
    }
    const match = /[?&]ticket=([^&#]*)/.exec(String(location));
    if (!match?.[1]) {
      return { success: false, message: "Authorization failed: no ticket." };
    }
    return { success: true, data: { ticket: match[1] } };
  } catch (e) {
    return { success: false, message: toErrMsg(e, "Get ticket failed") };
  }
}

async function getInfo(
  ticket: string,
  serviceUrl = callbackUrl,
): Promise<Result<{ userInfo: AttributeObject }>> {
  try {
    const validateResponse: AxiosResponse = await axios.post(
      `${casBase}/proxyValidate`,
      new URLSearchParams({
        service: serviceUrl,
        ticket,
      }).toString(),
      { headers: requestHeaders, timeout: 15000 },
    );

    const parser = new xml2js.Parser({ explicitArray: false });
    let parsed: any;
    try {
      parsed = await parser.parseStringPromise(validateResponse.data);
    } catch {
      return { success: false, message: "Failed to parse XML." };
    }

    const authSuccess =
      parsed?.["sso:serviceResponse"]?.["sso:authenticationSuccess"];
    if (!authSuccess) {
      return { success: false, message: "Authentication not successful." };
    }

    const attrs =
      (authSuccess["sso:attributes"]?.["sso:attribute"] as any[]) || [];
    const userInfo: AttributeObject = {};
    for (const a of attrs) {
      const name = a?.["$"]?.name;
      const value = a?.["$"]?.value ?? "";
      if (name) userInfo[name] = value;
    }

    const required = [
      "user_id",
      "unit_name",
      "id_number",
      "user_name",
      "id_type",
    ];
    for (const k of required) {
      if (!userInfo[k]) {
        return {
          success: false,
          message: `Missing required user info: ${k}`,
        };
      }
    }

    // if (userInfo["id_type"] !== "1") {
    //   return {
    //     success: false,
    //     message:
    //       "This identity service only supports undergraduate student accounts.",
    //   };
    // }

    return { success: true, data: { userInfo } };
  } catch (e) {
    return { success: false, message: toErrMsg(e, "Validate ticket failed") };
  }
}

export async function loginDcpCas(
  username: string,
  password: string,
  serviceUrl = callbackUrl,
): Promise<Result<LoginData>> {
  try {
    const tokenRes = await getToken(username, password, serviceUrl);
    if (!tokenRes.success) {
      return { success: false, message: tokenRes.message };
    }

    const service: Service = { url: serviceUrl };
    const ticketRes = await getTicket(tokenRes.data, service);
    if (!ticketRes.success) {
      return { success: false, message: ticketRes.message };
    }

    const infoRes = await getInfo(ticketRes.data.ticket, serviceUrl);
    if (!infoRes.success) {
      return { success: false, message: infoRes.message };
    }

    const ui = infoRes.data.userInfo;
    const extra = {
      alias: `${ui["user_name"]} / ${ui["unit_name"]} / ${ui["id_number"]}`,
      uuid: ui["user_id"] || "",
    };

    return {
      success: true,
      data: {
        token: tokenRes.data,
        ticket: ticketRes.data.ticket,
        userInfo: ui,
        extra,
      },
      message: "Success",
      extra,
    };
  } catch (e) {
    return { success: false, message: toErrMsg(e, "CAS login failed") };
  }
}

export async function validateCasTicket(
  ticket: string,
  serviceUrl = callbackUrl,
): Promise<Result<{ userInfo: AttributeObject }>> {
  try {
    const validateResponse: AxiosResponse = await axios.post(
      `${casBase}/proxyValidate`,
      new URLSearchParams({
        service: serviceUrl,
        ticket,
      }).toString(),
      { headers: requestHeaders, timeout: 15000 },
    );

    const parser = new xml2js.Parser({ explicitArray: false });
    let parsed: any;
    try {
      parsed = await parser.parseStringPromise(validateResponse.data);
    } catch {
      return { success: false, message: "Failed to parse XML." };
    }

    const authSuccess =
      parsed?.["sso:serviceResponse"]?.["sso:authenticationSuccess"];
    if (!authSuccess) {
      return { success: false, message: "Authentication not successful." };
    }

    const attrs =
      (authSuccess["sso:attributes"]?.["sso:attribute"] as any[]) || [];
    const userInfo: AttributeObject = {};
    for (const a of attrs) {
      const name = a?.["$"]?.name;
      const value = a?.["$"]?.value ?? "";
      if (name) userInfo[name] = value;
    }

    const required = [
      "user_id",
      "unit_name",
      "id_number",
      "user_name",
      "id_type",
    ];
    for (const k of required) {
      if (!userInfo[k]) {
        return {
          success: false,
          message: `Missing required user info: ${k}`,
        };
      }
    }

    return { success: true, data: { userInfo } };
  } catch (e) {
    return { success: false, message: toErrMsg(e, "Validate ticket failed") };
  }
}

export async function loginWithEncryptedData(
  encryptedData: {
    rsa: string;
    ul: number;
    pl: number;
    lt: string;
    execution: string;
    _eventId: string;
  },
  serviceUrl = callbackUrl,
): Promise<Result<LoginData>> {
  try {
    const loginResponse: AxiosResponse = await axios.post(
      `${casBase}/login?service=${encodeURIComponent(serviceUrl)}`,
      new URLSearchParams({
        rsa: encryptedData.rsa,
        ul: String(encryptedData.ul),
        pl: String(encryptedData.pl),
        lt: encryptedData.lt,
        execution: encryptedData.execution,
        _eventId: encryptedData._eventId,
      }).toString(),
      {
        headers: requestHeaders,
        maxRedirects: 0,
        validateStatus: (s) => s >= 200 && s < 400,
        timeout: 15000,
      },
    );

    const loginSetCookieHeader = loginResponse.headers["set-cookie"];
    if (!loginSetCookieHeader) {
      try {
        const $login = cheerio.load(loginResponse.data);
        const loginErrorMsg = $login("#errormsghide").text()?.trim();
        if (loginErrorMsg) {
          return { success: false, message: loginErrorMsg };
        }
      } catch {}
      return { success: false, message: "Login failed: no cookies returned." };
    }

    const parsedLoginCookies = setCookie.parse(loginSetCookieHeader);
    const hasTgc = parsedLoginCookies.some((c) => c.name.startsWith("CASTGC"));
    if (!hasTgc) {
      try {
        const $login = cheerio.load(loginResponse.data);
        const loginErrorMsg = $login("#errormsghide").text()?.trim();
        if (loginErrorMsg) {
          return { success: false, message: loginErrorMsg };
        }
      } catch {}
      return { success: false, message: "Login failed: no CASTGC cookie." };
    }

    const cookie = parsedLoginCookies
      .filter((c) => c.name !== "Language")
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    const token: Token = { cookie };

    const service: Service = { url: serviceUrl };
    const ticketRes = await getTicket(token, service);
    if (!ticketRes.success) {
      return { success: false, message: ticketRes.message };
    }

    const infoRes = await getInfo(ticketRes.data.ticket, serviceUrl);
    if (!infoRes.success) {
      return { success: false, message: infoRes.message };
    }

    const ui = infoRes.data.userInfo;
    const extra = {
      alias: `${ui["user_name"]} / ${ui["unit_name"]} / ${ui["id_number"]}`,
      uuid: ui["user_id"] || "",
    };

    return {
      success: true,
      data: {
        token,
        ticket: ticketRes.data.ticket,
        userInfo: ui,
        extra,
      },
      message: "Success",
      extra,
    };
  } catch (e) {
    return {
      success: false,
      message: toErrMsg(e, "Encrypted CAS login failed"),
    };
  }
}

export async function getLoginTokens(
  serviceUrl = callbackUrl,
): Promise<Result<{ lt: string; execution: string; cookie: string }>> {
  try {
    const initResponse: AxiosResponse = await axios.get(
      `${casBase}/login?service=${encodeURIComponent(
        serviceUrl,
      )}&renew=true&_=${Date.now()}`,
      { headers: requestHeaders, timeout: 15000 },
    );

    const initSetCookieHeader = initResponse.headers["set-cookie"];
    if (!initSetCookieHeader) {
      return { success: false, message: "Remote server error: no Set-Cookie." };
    }

    const initCookies = setCookie.parse(initSetCookieHeader);
    const hasSession = initCookies.some((c) =>
      c.name.startsWith("JSESSIONIDCAS"),
    );
    if (!hasSession) {
      return { success: false, message: "Remote server error: no session." };
    }

    const cookieString = buildCookieString(initSetCookieHeader);
    const $init = cheerio.load(initResponse.data);
    const lt = ($init("#lt").val() as string) || "";
    const execution = ($init('input[name="execution"]').val() as string) || "";

    if (!lt || !execution) {
      return {
        success: false,
        message: "Failed to get login tokens (lt/execution).",
      };
    }

    return {
      success: true,
      data: { lt, execution, cookie: cookieString },
    };
  } catch (e) {
    return { success: false, message: toErrMsg(e, "Get login tokens failed") };
  }
}

export async function submitLogin(
  cookie: string,
  rsa: string,
  ul: string,
  pl: string,
  lt: string,
  execution: string,
  serviceUrl = callbackUrl,
): Promise<Result<{ cookie: string }>> {
  try {
    const loginResponse: AxiosResponse = await axios.post(
      `${casBase}/login?service=${encodeURIComponent(serviceUrl)}`,
      new URLSearchParams({
        rsa,
        ul,
        pl,
        lt,
        execution,
        _eventId: "submit",
      }).toString(),
      {
        headers: { ...requestHeaders, Cookie: cookie },
        maxRedirects: 0,
        validateStatus: (s) => s >= 200 && s < 400,
        timeout: 15000,
      },
    );

    const loginSetCookieHeader = loginResponse.headers["set-cookie"];
    if (!loginSetCookieHeader) {
      try {
        const $login = cheerio.load(loginResponse.data);
        const loginErrorMsg = $login("#errormsghide").text()?.trim();
        if (loginErrorMsg) {
          return { success: false, message: loginErrorMsg };
        }
      } catch {}
      return { success: false, message: "Login failed: no cookies returned." };
    }

    const parsedLoginCookies = setCookie.parse(loginSetCookieHeader);
    const hasTgc = parsedLoginCookies.some((c) => c.name.startsWith("CASTGC"));
    if (!hasTgc) {
      try {
        const $login = cheerio.load(loginResponse.data);
        const loginErrorMsg = $login("#errormsghide").text()?.trim();
        if (loginErrorMsg) {
          return { success: false, message: loginErrorMsg };
        }
      } catch {}
      return { success: false, message: "Login failed: no CASTGC cookie." };
    }

    const newCookie = parsedLoginCookies
      .filter((c) => c.name !== "Language")
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    return { success: true, data: { cookie: newCookie } };
  } catch (e) {
    // console.log(e);
    return { success: false, message: toErrMsg(e, "Submit login failed") };
  }
}

// Example usage (uncomment to run directly):
// (async () => {
//   const res = await loginDcpCas("username", "password");
//   if (res.success) {
//     console.log("Login successful:", res);
//   } else {
//     console.error("Login failed:", res);
//   }
// })();
