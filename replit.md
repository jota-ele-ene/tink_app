# PIDA - Payment Initiation with Digital Account Verification

## Overview
PIDA is a Node.js application that integrates with Tink API for payment processing and account verification. It provides a web interface for initiating payments with digital account verification using Open Banking standards.

## Project Structure
```
.
├── server.js              # Main server file (Node.js HTTP server)
├── templates/             # HTML templates
│   ├── home.html          # Main form page
│   ├── email_verification.html
│   ├── email_payment.html
│   ├── email_sent_confirmation.html
│   └── callback_template.html
├── package.json           # Node.js dependencies
├── env_example.txt        # Example environment variables
└── .env                   # Environment configuration (create from env_example.txt)
```

## Tech Stack
- **Runtime**: Node.js
- **HTTP Server**: Native Node.js http module
- **Email**: Nodemailer with Gmail
- **API Integration**: Tink API for Open Banking

## Running the Application
The server runs on port 5000 and is bound to 0.0.0.0 for Replit compatibility.

```bash
npm install
npm start
```

## Environment Variables
Required environment variables (see env_example.txt):
- `TINK_CLIENT_ID`: Tink API client ID
- `TINK_CLIENT_SECRET`: Tink API client secret
- `SERVER_PORT`: Server port (default: 5000)
- `CALLBACK_REDIRECT_URI`: OAuth callback URL
- `GMAIL_USER`: Gmail account for sending emails
- `GMAIL_PASS`: Gmail app password
- `GMAIL_FROM_NAME`: Sender name
- `GMAIL_FROM_EMAIL`: Sender email
- `DEFAULT_CURRENCY`: Default currency (EUR)
- `DEFAULT_MARKET`: Default market (ES)
- `PAYMENT_SCHEME`: Payment scheme (SEPA_CREDIT_TRANSFER)

## Recent Changes
- 2024-12-10: Configured for Replit environment (port 5000, bind to 0.0.0.0)
