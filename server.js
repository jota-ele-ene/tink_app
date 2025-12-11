const http = require("http");
const url = require("url");
const https = require("https");
const querystring = require("querystring");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
require("dotenv").config();
const os = require("os");

function loadConfig() {
  const requiredVars = [
    "TINK_CLIENT_ID",
    "TINK_CLIENT_SECRET",
    "GMAIL_USER",
    "GMAIL_PASS",
    "GMAIL_FROM_NAME",
    "GMAIL_FROM_EMAIL",
  ];

  const missing = requiredVars.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error("❌ ERROR: Faltan variables obligatorias en .env:");
    missing.forEach((key) => console.error(`   - ${key}`));
    process.exit(1);
  }

  return {
    tink_client_id: process.env.TINK_CLIENT_ID,
    tink_client_secret: process.env.TINK_CLIENT_SECRET,
    server_port: process.env.SERVER_PORT || "3000",
    gmail_user: process.env.GMAIL_USER,
    gmail_pass: process.env.GMAIL_PASS,
    gmail_from_name: process.env.GMAIL_FROM_NAME,
    gmail_from_email: process.env.GMAIL_FROM_EMAIL,
  };
}

// Cargar configuración al inicio
const config = loadConfig();
console.log("✅ Configuración cargada correctamente");

// Resto de tu servidor...
const express = require("express");
const app = express();

app.listen(config.port, () => {
  console.log(`🚀 Servidor en puerto ${config.port}`);
  console.log(`🚀 Servidor en http://${os.hostname}:${config.port}`);
});

// Load from .env or use defaults
const CLIENT_ID = config.tink_client_id;
const CLIENT_SECRET = config.tink_client_secret;
const CALLBACK_REDIRECT_URI = config.callback_url;
const SERVER_PORT = config.server_port;
const GMAIL_USER = config.gmail_user;
const GMAIL_PASS = config.gmail_pass;
const GMAIL_FROM_NAME = config.gmail_from_name;
const GMAIL_FROM_EMAIL = config.gmail_from_email;
const TINK_API_HOST = config.TINK_API_HOST || "api.tink.com";
const DEFAULT_CURRENCY = process.env.DEFAULT_CURRENCY || "EUR";
const DEFAULT_MARKET = process.env.DEFAULT_MARKET || "ES";
const PAYMENT_SCHEME = process.env.PAYMENT_SCHEME || "SEPA_CREDIT_TRANSFER";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: GMAIL_USER, pass: GMAIL_PASS },
});

const userSessions = {};

function log(level, msg, data = null) {
  const ts = new Date().toISOString();
  if (data) {
    console.log(`[${ts}] [${level}] ${msg}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`[${ts}] [${level}] ${msg}`);
  }
}

function logApiRequest(method, host, path, headers, body = null) {
  const ts = new Date().toISOString();
  console.log(`\n${"=".repeat(80)}`);
  console.log(`[${ts}] [API_REQUEST_FULL]`);
  console.log(`${"=".repeat(80)}`);
  console.log(`METHOD: ${method}`);
  console.log(`HOST: ${host}`);
  console.log(`PATH: ${path}`);
  console.log(`\nHEADERS:`);
  console.log(JSON.stringify(headers, null, 2));
  if (body) {
    console.log(`\nBODY:`);
    console.log(JSON.stringify(body, null, 2));
  }
  console.log(`${"=".repeat(80)}\n`);
}

function logApiResponse(statusCode, headers, body = null, error = null) {
  const ts = new Date().toISOString();
  console.log(`\n${"=".repeat(80)}`);
  console.log(`[${ts}] [API_RESPONSE_FULL]`);
  console.log(`${"=".repeat(80)}`);
  console.log(`STATUS CODE: ${statusCode}`);
  console.log(`\nRESPONSE HEADERS:`);
  console.log(JSON.stringify(headers, null, 2));
  if (body) {
    console.log(`\nRESPONSE BODY:`);
    try {
      console.log(JSON.stringify(JSON.parse(body), null, 2));
    } catch {
      console.log(body);
    }
  }
  if (error) {
    console.log(`\nERROR: ${error}`);
  }
  console.log(`${"=".repeat(80)}\n`);
}

function loadTemplate(filename) {
  return fs.readFileSync(path.join(__dirname, "templates", filename), "utf-8");
}

function formatNumber(number, locale = "es-ES") {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number);
}

function buildCallback(config) {
  const t = loadTemplate("callback_template.html");
  return t
    .replace("{ICON}", config.icon)
    .replace("{TITLE}", config.title)
    .replace("{SUBTITLE}", config.subtitle)
    .replace("{STATUS_BOX}", config.statusBox)
    .replace("{INFO_SECTION}", config.infoSection || "")
    .replace("{MESSAGE_BOX}", config.messageBox || "")
    .replace("{ERROR_SECTION}", config.errorSection || "")
    .replace("{EXTRA_BUTTON}", config.extraButton || "")
    .replace("{TIMESTAMP}", new Date().toLocaleString("es-ES"));
}

const server = http.createServer((req, res) => {
  hostname = req.headers.host;
  const u = url.parse(req.url, true);
  const p = u.pathname;
  const q = u.query;

  log("REQUEST", `${req.method} ${p}`, {
    headers: req.headers,
    query: q,
  });

  if (p === "/") {
    config.hostname = req.headers.host;
    log("INFO", "Sirviendo home.html desde " + config.hostname);
    config.callback_url = `http://${config.hostname}:${config.port}/callback`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(loadTemplate("home.html"));
    return;
  }

  if (p === "/start" && req.method === "POST") {
    log("START", "Recibiendo POST de /start");

    let body = "";

    req.on("data", (chunk) => {
      body += chunk.toString();
      log("DATA_CHUNK", `Recibido chunk: ${chunk.length} bytes`);
    });

    req.on("end", () => {
      log("REQUEST_BODY", "Body completo recibido", {
        bodyLength: body.length,
        body: body.substring(0, 200),
      });

      let params = {};

      try {
        if (body && body.length > 0) {
          params = querystring.parse(body);
          log("PARSED_PARAMS", "Parámetros parseados", params);
        } else {
          log("ERROR", "Body vacío recibido");
        }
      } catch (parseErr) {
        log("ERROR", "Error parseando body", { error: parseErr.message });
      }

      const eV = (params.emailVerification || "").trim();
      const eP = (params.emailPayment || "").trim();
      const amtRaw = (params.amount || "").trim();
      const cur = (params.currency || DEFAULT_CURRENCY).trim();

      log("EXTRACTED_PARAMS", "Parámetros extraídos", {
        emailVerification: eV,
        emailPayment: eP,
        amountRaw: formatNumber(amtRaw),
        currency: cur,
      });

      // Validaciones
      if (!eV) {
        log("ERROR", "Email verificación vacío");
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Error: Email de verificación no proporcionado");
        return;
      }

      if (!eP) {
        log("ERROR", "Email pago vacío");
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Error: Email de pago no proporcionado");
        return;
      }

      const amt = parseFloat(amtRaw);
      if (isNaN(amt) || amt <= 0) {
        log("ERROR", "Cantidad inválida", { amountRaw, parsed: amt });
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Error: Cantidad debe ser un número mayor a 0");
        return;
      }

      if (!cur) {
        log("ERROR", "Moneda vacía");
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Error: Moneda no proporcionada");
        return;
      }

      log("FORM_VALID", "Formulario válido", {
        emailVerification: eV,
        emailPayment: eP,
        amount: amt,
        currency: cur,
      });

      const sId = Date.now().toString();
      userSessions[sId] = { eV, eP, amt, cur };

      log("SESSION_CREATED", `Sesión: ${sId}`, { eV, eP, amt, cur });

      const ackUrl = `https://link.tink.com/1.0/account-check/?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(CALLBACK_REDIRECT_URI)}?session=${sId}&market=${DEFAULT_MARKET}&locale=es_ES&input_provider=es-demobank-open-banking-embedded`;

      log("ACCOUNT_CHECK_URL", "URL generada", { url: ackUrl });

      let et = loadTemplate("email_verification.html")
        .replace("{ACCOUNT_CHECK_URL}", ackUrl)
        .replace("{AMOUNT}", formatNumber(amt))
        .replace("{CURRENCY}", cur);

      log("EMAIL_VERIFICATION_SENDING", `Enviando email a: ${eV}`);

      transporter.sendMail(
        {
          from: `"${GMAIL_FROM_NAME}" <${GMAIL_FROM_EMAIL}>`,
          to: eV,
          subject: "Verifica tu cuenta para recibir el pago",
          html: et,
        },
        (err) => {
          if (err) {
            log("ERROR", "Fallo al enviar email", { error: err.message });
            res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
            res.end(`<h1>Error</h1><p>${err.message}</p>`);
            return;
          }

          log("EMAIL_VERIFICATION_SENT", `Email enviado a: ${eV}`);

          const confirmTemplate = loadTemplate("email_sent_confirmation.html");
          const html = confirmTemplate
            .replace("{EMAIL}", eV)
            .replace("{AMOUNT}", amt)
            .replace("{CURRENCY}", cur)
            .replace("{SESSION_ID}", sId);

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
        },
      );
    });

    req.on("error", (err) => {
      log("ERROR", "Error en request", { error: err.message });
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Error procesando solicitud");
    });

    return;
  }

  if (p === "/callback") {
    const authCode = q.code;
    const aId = q.account_verification_report_id;
    const pId = q.payment_request_id;
    const sId = q.session;
    const err = q.error;
    const errDesc = q.error_description;

    log("CALLBACK_RECEIVED", "Callback recibido", {
      hasAuthCode: !!authCode,
      hasAccountVerificationId: !!aId,
      hasPaymentRequestId: !!pId,
      sessionId: sId,
      hasError: !!err,
      errorCode: err,
      errorDescription: errDesc,
    });

    if (err) {
      log("CALLBACK_ERROR", `Error: ${err}`, { description: errDesc });
      const h = buildCallback({
        icon: "❌",
        title: "Error en el flujo",
        subtitle: "Algo salió mal",
        statusBox: `<div class="status-box status-error"><span class="label">Error</span></div>`,
        errorSection: `<div class="error-details"><strong>Código:</strong> ${err}</div>`,
        messageBox: `<div class="message-box"><strong>Cancelado</strong></div>`,
      });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(h);
      return;
    }

    if (aId) {
      log("ACCOUNT_CHECK_CALLBACK", `Report ID: ${aId}`, {
        hasAuthCode: !!authCode,
      });

      if (authCode) {
        log(
          "AUTH_CODE_FOUND",
          `Usando authorization_code: ${authCode.substring(0, 20)}...`,
        );
        handleAccountWithAuthCode(res, aId, authCode, sId);
      } else {
        log("WARNING", "No auth code en callback, usando client_credentials");
        handleAccount(res, aId, sId);
      }
      return;
    }

    if (pId) {
      log("PAYMENT_CALLBACK", `Payment ID: ${pId}`);
      handlePayment(res, pId);
      return;
    }

    log("CALLBACK_INVALID", "Sin parámetros válidos");
    const h = buildCallback({
      icon: "⚠️",
      title: "Parámetros inválidos",
      subtitle: "Solicitud incompleta",
      statusBox: `<div class="status-box status-error"><span class="label">Error</span></div>`,
      errorSection: `<div class="error-details">Parámetros faltantes</div>`,
      messageBox: `<div class="message-box"><strong>Intenta de nuevo</strong></div>`,
    });
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(h);
  }

  res.writeHead(404);
  res.end("Not Found");
});

function handleAccountWithAuthCode(res, rId, authCode, sId) {
  const s = userSessions[sId];

  if (!s) {
    log("ERROR", `Sesión no encontrada: ${sId}`);
    const h = buildCallback({
      icon: "❌",
      title: "Sesión expirada",
      subtitle: "Datos no encontrados",
      statusBox: `<div class="status-box status-error"><span class="label">Error</span></div>`,
      errorSection: `<div class="error-details">Sesión expirada</div>`,
      messageBox: `<div class="message-box"><strong>Vuelve a comenzar</strong></div>`,
    });
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    res.end(h);
    return;
  }

  const { eP, amt, cur } = s;

  log("ACCOUNT_HANDLER_WITH_AUTH", "Iniciando con authorization_code", {
    sessionId: sId,
    eP,
    amt,
    cur,
  });

  getTokenFromAuthCode(authCode, (err, userTok) => {
    if (err) {
      log("ERROR", `Auth code token error: ${err}`);
      const h = buildCallback({
        icon: "❌",
        title: "Error de autenticación",
        subtitle: "No se pudo obtener token de usuario",
        statusBox: `<div class="status-box status-error"><span class="label">Error</span></div>`,
        errorSection: `<div class="error-details">${err}</div>`,
        messageBox: `<div class="message-box"><strong>Error de servidor</strong></div>`,
      });
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end(h);
      return;
    }

    log("USER_TOKEN_OBTAINED", "Token de usuario obtenido exitosamente");

    getReport(userTok, rId, (err, rep) => {
      if (err) {
        log("ERROR", `Report error: ${err}`);
        const h = buildCallback({
          icon: "❌",
          title: "Error de verificación",
          subtitle: "No se pudo obtener datos",
          statusBox: `<div class="status-box status-error"><span class="label">Error</span></div>`,
          errorSection: `<div class="error-details">${err}</div>`,
          messageBox: `<div class="message-box"><strong>Intenta de nuevo</strong></div>`,
        });
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(h);
        return;
      }

      log("VERIFICATION_REPORT_RECEIVED", "Reporte obtenido");

      let ib = null,
        ah = "Usuario",
        mk = DEFAULT_MARKET;

      if (
        rep &&
        rep.userDataByProvider &&
        rep.userDataByProvider[0] &&
        rep.userDataByProvider[0].accounts &&
        rep.userDataByProvider[0].accounts[0]
      ) {
        const ac = rep.userDataByProvider[0].accounts[0];
        ib = ac.iban;
        ah = ac.holderName || ac.name || "Usuario";
        mk = ib.substring(0, 2);
        log("ACCOUNT_DATA_EXTRACTED", "Datos extraídos", {
          iban: ib,
          holder: ah,
          market: mk,
        });
      }

      if (!ib) {
        log("ERROR", "IBAN no encontrado");
        const h = buildCallback({
          icon: "❌",
          title: "IBAN no encontrado",
          subtitle: "Verificación incompleta",
          statusBox: `<div class="status-box status-error"><span class="label">Error</span></div>`,
          errorSection: `<div class="error-details">Sin IBAN</div>`,
          messageBox: `<div class="message-box"><strong>Verifica tus datos</strong></div>`,
        });
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(h);
        return;
      }

      log("PAYMENT_REQUEST_CREATING", "Creando payment request", {
        iban: ib,
        holder: ah,
        market: mk,
        amount: amt,
        currency: cur,
      });

      getToken((err, tok) => {
        if (err) {
          log("ERROR", `Client token error: ${err}`);
          res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
          res.end("Error");
          return;
        }

        createPayReq(tok, ib, ah, mk, amt, cur, (err, pId) => {
          if (err) {
            log("ERROR", `Payment request error: ${err}`);
            const h = buildCallback({
              icon: "❌",
              title: "Error de pago",
              subtitle: "No se pudo crear",
              statusBox: `<div class="status-box status-error"><span class="label">Error</span></div>`,
              errorSection: `<div class="error-details">${err}</div>`,
              messageBox: `<div class="message-box"><strong>Intenta de nuevo</strong></div>`,
            });
            res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
            res.end(h);
            return;
          }

          log("PAYMENT_REQUEST_CREATED", `Payment ID: ${pId}`);

          const pUrl = `https://link.tink.com/1.0/pay/?client_id=${CLIENT_ID}&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback&market=${mk}&locale=es_ES&payment_request_id=${pId}`;

          log("PAYMENT_URL_GENERATED", "URL generada", { url: pUrl });

          let pt = loadTemplate("email_payment.html")
            .replace("{ACCOUNT_HOLDER}", ah)
            .replace("{IBAN}", ib)
            .replace("{PAYMENT_URL}", pUrl)
            .replace("{AMOUNT}", formatNumber(amt))
            .replace("{CURRENCY}", cur);

          log("PAYMENT_EMAIL_SENDING", `Enviando a: ${eP}`, {
            amount: amt,
            currency: cur,
          });

          transporter.sendMail(
            {
              from: `"${GMAIL_FROM_NAME}" <${GMAIL_FROM_EMAIL}>`,
              to: eP,
              subject: "Completa el pago pendiente",
              html: pt,
            },
            (mailErr) => {
              if (mailErr) {
                log("ERROR", `Email error: ${mailErr.message}`);
              } else {
                log("PAYMENT_EMAIL_SENT", `Email enviado a: ${eP}`);
              }
            },
          );

          const h = buildCallback({
            icon: "✓",
            title: "Cuenta verificada",
            subtitle: "Listo para pagar",
            statusBox: `<div class="status-box status-success"><span class="label">✓ OK</span></div>`,
            infoSection: `
              <div class="info-section">
                <div class="info-row">
                  <span class="info-label">IBAN:</span>
                  <span class="info-value">${ib}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Titular:</span>
                  <span class="info-value">${ah}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Importe a recibir:</span>
                  <span class="info-value">${amt} ${cur}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">Payment ID:</span>
                  <span class="info-value">${pId}</span>
                </div>
              </div>
            `,
            messageBox: `<div class="message-box"><strong>✓ Email enviado a ${eP}</strong><br>Revisa tu bandeja de entrada</div>`,
          });

          log("ACCOUNT_CHECK_SUCCESS", "Flujo completado");

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(h);
        });
      });
    });
  });
}

function handleAccount(res, rId, sId) {
  const s = userSessions[sId];

  if (!s) {
    log("ERROR", `Sesión no encontrada: ${sId}`);
    const h = buildCallback({
      icon: "❌",
      title: "Sesión expirada",
      subtitle: "Datos no encontrados",
      statusBox: `<div class="status-box status-error"><span class="label">Error</span></div>`,
      errorSection: `<div class="error-details">Sesión expirada</div>`,
      messageBox: `<div class="message-box"><strong>Vuelve a comenzar</strong></div>`,
    });
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    res.end(h);
    return;
  }

  const { eP, amt, cur } = s;

  log("ACCOUNT_HANDLER", "Iniciando", { sessionId: sId, eP, amt, cur });

  getToken((err, tok) => {
    if (err) {
      log("ERROR", `Token error: ${err}`);
      const h = buildCallback({
        icon: "❌",
        title: "Error de autenticación",
        subtitle: "No se pudo conectar",
        statusBox: `<div class="status-box status-error"><span class="label">Error</span></div>`,
        errorSection: `<div class="error-details">${err}</div>`,
        messageBox: `<div class="message-box"><strong>Error de servidor</strong></div>`,
      });
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end(h);
      return;
    }

    log("TOKEN_OBTAINED", "Token obtenido");

    getReport(tok, rId, (err, rep) => {
      if (err) {
        log("ERROR", `Report error: ${err}`);
        const h = buildCallback({
          icon: "❌",
          title: "Error de verificación",
          subtitle: "No se pudo obtener datos",
          statusBox: `<div class="status-box status-error"><span class="label">Error</span></div>`,
          errorSection: `<div class="error-details">${err}</div>`,
          messageBox: `<div class="message-box"><strong>Intenta de nuevo</strong></div>`,
        });
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(h);
        return;
      }

      log("VERIFICATION_REPORT_RECEIVED", "Reporte obtenido");

      let ib = null,
        ah = "Usuario",
        mk = DEFAULT_MARKET;

      if (
        rep &&
        rep.userDataByProvider &&
        rep.userDataByProvider[0] &&
        rep.userDataByProvider[0].accounts &&
        rep.userDataByProvider[0].accounts[0]
      ) {
        const ac = rep.userDataByProvider[0].accounts[0];
        ib = ac.iban;
        ah = ac.holderName || ac.name || "Usuario";
        mk = ib.substring(0, 2);
        log("ACCOUNT_DATA_EXTRACTED", "Datos extraídos", {
          iban: ib,
          holder: ah,
          market: mk,
        });
      }

      if (!ib) {
        log("ERROR", "IBAN no encontrado");
        const h = buildCallback({
          icon: "❌",
          title: "IBAN no encontrado",
          subtitle: "Verificación incompleta",
          statusBox: `<div class="status-box status-error"><span class="label">Error</span></div>`,
          errorSection: `<div class="error-details">Sin IBAN</div>`,
          messageBox: `<div class="message-box"><strong>Verifica tus datos</strong></div>`,
        });
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(h);
        return;
      }

      log("PAYMENT_REQUEST_CREATING", "Creando payment request", {
        iban: ib,
        holder: ah,
        market: mk,
        amount: amt,
        currency: cur,
      });

      createPayReq(tok, ib, ah, mk, amt, cur, (err, pId) => {
        if (err) {
          log("ERROR", `Payment request error: ${err}`);
          const h = buildCallback({
            icon: "❌",
            title: "Error de pago",
            subtitle: "No se pudo crear",
            statusBox: `<div class="status-box status-error"><span class="label">Error</span></div>`,
            errorSection: `<div class="error-details">${err}</div>`,
            messageBox: `<div class="message-box"><strong>Intenta de nuevo</strong></div>`,
          });
          res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
          res.end(h);
          return;
        }

        log("PAYMENT_REQUEST_CREATED", `Payment ID: ${pId}`);

        const pUrl = `https://link.tink.com/1.0/pay/?client_id=${CLIENT_ID}&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback&market=${mk}&locale=es_ES&payment_request_id=${pId}`;

        log("PAYMENT_URL_GENERATED", "URL generada", { url: pUrl });

        let pt = loadTemplate("email_payment.html")
          .replace("{ACCOUNT_HOLDER}", ah)
          .replace("{IBAN}", ib)
          .replace("{PAYMENT_URL}", pUrl)
          .replace("{AMOUNT}", formatNumber(amt))
          .replace("{CURRENCY}", cur);

        log("PAYMENT_EMAIL_SENDING", `Enviando a: ${eP}`, {
          amount: amt,
          currency: cur,
        });

        transporter.sendMail(
          {
            from: `"${GMAIL_FROM_NAME}" <${GMAIL_FROM_EMAIL}>`,
            to: eP,
            subject: "Inicia tu pago pendiente",
            html: pt,
          },
          (mailErr) => {
            if (mailErr) {
              log("ERROR", `Email error: ${mailErr.message}`);
            } else {
              log("PAYMENT_EMAIL_SENT", `Email enviado a: ${eP}`);
            }
          },
        );

        const h = buildCallback({
          icon: "✓",
          title: "Cuenta verificada",
          subtitle: "Listo para pagar",
          statusBox: `<div class="status-box status-success"><span class="label">✓ OK</span></div>`,
          infoSection: `
            <div class="info-section">
              <div class="info-row">
                <span class="info-label">IBAN:</span>
                <span class="info-value">${ib}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Titular:</span>
                <span class="info-value">${ah}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Importe a recibir:</span>
                <span class="info-value">${amt} ${cur}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Payment ID:</span>
                <span class="info-value">${pId}</span>
              </div>
            </div>
          `,
          messageBox: `<div class="message-box"><strong>✓ Email enviado a ${eP}</strong><br>Revisa tu bandeja de entrada</div>`,
        });

        log("ACCOUNT_CHECK_SUCCESS", "Flujo completado");

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(h);
      });
    });
  });
}

function handlePayment(res, pId) {
  log("PAYMENT_HANDLER", `Payment ID: ${pId}`);

  getToken((err, tok) => {
    if (err) {
      log("ERROR", `Token error: ${err}`);
      const h = buildCallback({
        icon: "❌",
        title: "Error",
        subtitle: "No se pudieron obtener detalles",
        statusBox: `<div class="status-box status-error"><span class="label">Error</span></div>`,
        errorSection: `<div class="error-details">${err}</div>`,
        messageBox: `<div class="message-box"><strong>Intenta de nuevo</strong></div>`,
      });
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end(h);
      return;
    }

    log("TOKEN_OBTAINED", "Token obtenido para detalles");

    getPayDetail(tok, pId, (err, det) => {
      if (err) {
        log("ERROR", `Details error: ${err}`);
      } else {
        log("PAYMENT_DETAILS_RECEIVED", "Detalles obtenidos", {
          amount: det.amount,
          currency: det.currency,
          status: det.status,
        });
      }

      const amt = formatNumber(det && det.amount) || "N/A";
      const cur = (det && det.currency) || "N/A";
      const ib = (det && det.recipient && det.recipient.accountNumber) || "N/A";
      const nm = (det && det.recipientName) || "N/A";
      const st = (det && det.status) || "UNKNOWN";

      const sc =
        st.toUpperCase() === "COMPLETED" ? "status-success" : "status-error";
      const ic = st.toUpperCase() === "COMPLETED" ? "✓" : "⏳";

      log("PAYMENT_STATUS", `Estado: ${st}`, { amount: amt, currency: cur });

      const h = buildCallback({
        icon: ic,
        title:
          st.toUpperCase() === "COMPLETED"
            ? "Pago completado"
            : "Pago en proceso",
        subtitle: `Estado: ${st}`,
        statusBox: `<div class="status-box ${sc}"><span class="label">${ic} ${st}</span></div>`,
        infoSection: `
          <div class="info-section">
            <div class="info-row">
              <span class="info-label">Importe transferencia:</span>
              <span class="info-value">${amt} ${cur}</span>
            </div>
            <div class="info-row">
              <span class="info-label">Payment ID:</span>
              <span class="info-value">${pId}</span>
            </div>
          </div>
        `,
        messageBox: `<div class="message-box"><strong>${ic} Pago ${st}</strong><br>Se procesó tu solicitud</div>`,
      });

      log("PAYMENT_COMPLETE", "Flujo completado");

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(h);
    });
  });
}

function getToken(cb) {
  const data = {
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  };

  const d = querystring.stringify(data);

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "Content-Length": Buffer.byteLength(d),
  };

  logApiRequest("POST", TINK_API_HOST, "/api/v1/oauth/token", headers, data);

  const req = https.request(
    {
      hostname: TINK_API_HOST,
      path: "/api/v1/oauth/token",
      method: "POST",
      headers: headers,
    },
    (r) => {
      let bd = "";
      r.on("data", (c) => (bd += c));
      r.on("end", () => {
        logApiResponse(r.statusCode, r.headers, bd);

        if (r.statusCode === 200) {
          try {
            const parsed = JSON.parse(bd);
            log("API_SUCCESS", "Token obtenido");
            cb(null, parsed.access_token);
          } catch (e) {
            log("ERROR", `Parse error: ${e.message}`);
            cb(e.message);
          }
        } else {
          log("API_ERROR", `HTTP ${r.statusCode}`, { body: bd });
          cb("HTTP " + r.statusCode);
        }
      });
    },
  );
  req.on("error", (e) => {
    log("ERROR", `Request error: ${e.message}`);
    logApiResponse(0, {}, null, e.message);
    cb(e.message);
  });
  req.write(d);
  req.end();
}

function getTokenFromAuthCode(authCode, cb) {
  const data = {
    grant_type: "authorization_code",
    code: authCode,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  };

  const d = querystring.stringify(data);

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "Content-Length": Buffer.byteLength(d),
  };

  logApiRequest("POST", TINK_API_HOST, "/api/v1/oauth/token", headers, data);

  const req = https.request(
    {
      hostname: TINK_API_HOST,
      path: "/api/v1/oauth/token",
      method: "POST",
      headers: headers,
    },
    (r) => {
      let bd = "";
      r.on("data", (c) => (bd += c));
      r.on("end", () => {
        logApiResponse(r.statusCode, r.headers, bd);

        if (r.statusCode === 200) {
          try {
            const parsed = JSON.parse(bd);
            log("API_SUCCESS", "User token obtenido desde authorization_code");
            cb(null, parsed.access_token);
          } catch (e) {
            log("ERROR", `Parse error: ${e.message}`);
            cb(e.message);
          }
        } else {
          log("API_ERROR", `HTTP ${r.statusCode}`, { body: bd });
          cb("HTTP " + r.statusCode);
        }
      });
    },
  );
  req.on("error", (e) => {
    log("ERROR", `Request error: ${e.message}`);
    logApiResponse(0, {}, null, e.message);
    cb(e.message);
  });
  req.write(d);
  req.end();
}

function getReport(tok, rId, cb) {
  const headers = {
    Authorization: `Bearer ${tok}`,
  };

  logApiRequest(
    "GET",
    TINK_API_HOST,
    `/api/v1/account-verification-reports/${rId}`,
    headers,
  );

  https
    .get(
      {
        hostname: TINK_API_HOST,
        path: `/api/v1/account-verification-reports/${rId}`,
        headers: headers,
      },
      (r) => {
        let bd = "";
        r.on("data", (c) => (bd += c));
        r.on("end", () => {
          logApiResponse(r.statusCode, r.headers, bd);

          if (r.statusCode === 200) {
            try {
              const parsed = JSON.parse(bd);
              log("API_SUCCESS", "Report obtenido");
              cb(null, parsed);
            } catch (e) {
              log("ERROR", `Parse error: ${e.message}`);
              cb(e.message);
            }
          } else {
            log("API_ERROR", `HTTP ${r.statusCode}`, { body: bd });
            cb("HTTP " + r.statusCode);
          }
        });
      },
    )
    .on("error", (e) => {
      log("ERROR", `Request error: ${e.message}`);
      logApiResponse(0, {}, null, e.message);
      cb(e.message);
    });
}

function getPayDetail(tok, pId, cb) {
  const headers = {
    Authorization: `Bearer ${tok}`,
  };

  logApiRequest(
    "GET",
    TINK_API_HOST,
    `/api/v1/payments/requests/${pId}`,
    headers,
  );

  https
    .get(
      {
        hostname: TINK_API_HOST,
        path: `/api/v1/payments/requests/${pId}`,
        headers: headers,
      },
      (r) => {
        let bd = "";
        r.on("data", (c) => (bd += c));
        r.on("end", () => {
          logApiResponse(r.statusCode, r.headers, bd);

          if (r.statusCode === 200) {
            try {
              const parsed = JSON.parse(bd);
              log("API_SUCCESS", "Detalles obtenidos");
              cb(null, parsed);
            } catch (e) {
              log("ERROR", `Parse error: ${e.message}`);
              cb(e.message);
            }
          } else {
            log("API_ERROR", `HTTP ${r.statusCode}`, { body: bd });
            cb("HTTP " + r.statusCode);
          }
        });
      },
    )
    .on("error", (e) => {
      log("ERROR", `Request error: ${e.message}`);
      logApiResponse(0, {}, null, e.message);
      cb(e.message);
    });
}

function createPayReq(tok, ib, nm, mk, amt, cur, cb) {
  const paymentData = {
    recipient: { accountNumber: ib, accountType: "iban" },
    amount: amt,
    currency: cur,
    market: mk,
    recipientName: nm,
    sourceMessage: "Payment confirmation",
    remittanceInformation: { type: "UNSTRUCTURED", value: "Payment" },
    paymentScheme: PAYMENT_SCHEME,
  };

  const d = JSON.stringify(paymentData);

  const headers = {
    Authorization: `Bearer ${tok}`,
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(d),
  };

  logApiRequest(
    "POST",
    TINK_API_HOST,
    "/api/v1/payments/requests",
    headers,
    paymentData,
  );

  const req = https.request(
    {
      hostname: TINK_API_HOST,
      path: "/api/v1/payments/requests",
      method: "POST",
      headers: headers,
    },
    (r) => {
      let bd = "";
      r.on("data", (c) => (bd += c));
      r.on("end", () => {
        logApiResponse(r.statusCode, r.headers, bd);

        if (r.statusCode === 201 || r.statusCode === 200) {
          try {
            const parsed = JSON.parse(bd);
            log("API_SUCCESS", "Payment request creado", { id: parsed.id });
            cb(null, parsed.id);
          } catch (e) {
            log("ERROR", `Parse error: ${e.message}`);
            cb(e.message);
          }
        } else {
          log("API_ERROR", `HTTP ${r.statusCode}`, { body: bd });
          cb("HTTP " + r.statusCode);
        }
      });
    },
  );
  req.on("error", (e) => {
    log("ERROR", `Request error: ${e.message}`);
    logApiResponse(0, {}, null, e.message);
    cb(e.message);
  });
  req.write(d);
  req.end();
}

server.listen(SERVER_PORT, "0.0.0.0", () => {
  const serverName = os.hostname();
  log("START", "========================================");
  log("START", "PIDA Server v1.5.0 - LOGS COMPLETOS API");
  log("START", `http://localhost:${SERVER_PORT}`);
  log("START", `http://${serverName}:${SERVER_PORT}`);
  log("START", "========================================");
  log("CONFIG", "Usando variables de .env", {
    CLIENT_ID: CLIENT_ID.substring(0, 20) + "...",
    TINK_API_HOST: TINK_API_HOST,
    DEFAULT_MARKET: DEFAULT_MARKET,
    DEFAULT_CURRENCY: DEFAULT_CURRENCY,
    GMAIL_USER: GMAIL_USER,
  });
  log("START", "========================================");
});
