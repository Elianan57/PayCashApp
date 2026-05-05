# CashApp Checkout - Polapine Payment Integration

A complete checkout page integrated with Polapine payment gateway for sandbox testing.

## Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment (Optional)
Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

The server comes pre-configured with sandbox credentials, so you can skip this step for testing.

### 3. Start the Server
```bash
npm start
```

The server will run on `http://localhost:3000`

### 4. Open in Browser
Visit: **http://localhost:3000**

## Features

✅ Beautiful dark-themed checkout page  
✅ Form validation (name, email, amount)  
✅ Quick amount buttons ($10, $15, $20, $25)  
✅ Polapine API integration  
✅ Sandbox mode testing  
✅ Responsive mobile design  
✅ Loading states and error handling  

## API Endpoints

### POST `/api/create-invoice`
Creates a payment invoice and returns the payment URL.

**Request Body:**
```json
{
  "customer_name": "John Doe",
  "customer_email": "john@example.com",
  "amount": 10.00,
  "order_reference": "ORD-12345"
}
```

**Response:**
```json
{
  "success": true,
  "invoice_id": "INV-ABC123",
  "payment_url": "https://pay.polapine.com/pay/INV-ABC123",
  "amount": 10.00,
  "status": "pending"
}
```

### POST `/webhook`
Webhook endpoint for payment notifications.

## Polapine API Details

- **Sandbox Base URL:** `https://pay.polapine.com/api/sandbox/`
- **API Key:** `pk_sandbox_569ccf41cc4120ebcdaa4a3c5d2f4e93`
- **API Secret:** `sk_sandbox_128bb6d5f114e992ebf280e4be7a2f541037a7d26601ef0732ebb0d0c7afcd9e`

## Testing Payments

1. Fill in the checkout form:
   - Full Name: `John Doe`
   - Email: `test@example.com`
   - Amount: `10.00` - `2000.00`

2. Click "Continue to payment"

3. You'll be redirected to Polapine's payment page

4. Use sandbox test cards to complete the payment

## Project Structure

```
├── server.js              # Express server & API routes
├── package.json           # Dependencies
├── .env.example          # Environment variables template
├── README.md             # This file
└── public/
    └── index.html        # Checkout page
```

## Environment Variables

- `PORT` - Server port (default: 3000)
- `POLAPINE_API_KEY` - Sandbox API key
- `POLAPINE_API_SECRET` - Sandbox API secret
- `WEBHOOK_URL` - Webhook endpoint URL

## Security Notes

⚠️ **Never expose API secrets in client code**
- All API calls are made from the backend (server.js)
- API credentials are stored in environment variables
- Frontend only sends form data to backend

## Error Handling

The checkout page includes:
- Form validation
- Amount range validation ($10 - $2,000)
- API error handling
- User-friendly error messages
- Loading states

## Webhooks

The `/webhook` endpoint receives payment notifications:

```json
{
  "event": "payment.completed",
  "invoice_id": "INV-ABC123",
  "amount": 10.00,
  "status": "completed",
  "order_reference": "ORDER-12345",
  "customer_email": "customer@example.com"
}
```

## Next Steps

1. ✅ Test the checkout page locally
2. ✅ Verify payment flow with Polapine
3. ✅ Implement webhook signature verification
4. ✅ Deploy to production (change to live API keys)
5. ✅ Update database/order system to handle webhooks

## Support

For API documentation, visit: https://pay.polapine.com/api/docs
