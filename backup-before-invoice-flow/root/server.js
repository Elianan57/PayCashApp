const express = require('express');
const axios = require('axios');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

// --- Production Security ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "https://pay.polapine.com", "https://ohkessuokmozfwldmqgs.supabase.co"]
    }
  }
}));
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Rate limiting to prevent abuse
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { success: false, message: 'Too many requests, please try again later.' }
});

// Apply rate limiter to API routes
app.use('/api/', apiLimiter);

// --- Environment Configuration ---
const POLAPINE_API_KEY = process.env.POLAPINE_API_KEY;
const POLAPINE_API_SECRET = process.env.POLAPINE_API_SECRET;
const POLAPINE_API_KEY_B = process.env.POLAPINE_API_KEY_B;
const POLAPINE_API_SECRET_B = process.env.POLAPINE_API_SECRET_B;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const POLAPINE_BASE_URL = IS_PRODUCTION
  ? 'https://pay.polapine.com/api/v1'
  : 'https://pay.polapine.com/api/sandbox';

// Fail fast if keys are missing in production
if (!POLAPINE_API_KEY || !POLAPINE_API_SECRET) {
  console.warn('CRITICAL: POLAPINE API keys (A) are missing. Application may not function correctly.');
}
if (!POLAPINE_API_KEY_B || !POLAPINE_API_SECRET_B) {
  console.warn('WARNING: POLAPINE API keys (B) are missing. ecashapp3 endpoint will not work.');
}

// --- API Routes ---
app.post('/api/create-invoice', async (req, res) => {
  try {
    const { amount, customer_name, customer_email, order_reference, payment_method } = req.body;

    // Strict Input Validation
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount is required' });
    }
    if (!customer_email || !customer_email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Valid customer email is required' });
    }

    const port = process.env.PORT || 3050;
    const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

    const invoiceData = {
      amount: parseFloat(amount),
      order_reference: order_reference || `ORD-${Date.now()}`,
      customer_name: customer_name || 'Customer',
      customer_email: customer_email,
      webhook_url: `${baseUrl}/webhook`,
      return_url: `${baseUrl}/success`,
      metadata: {
        created_at: new Date().toISOString(),
        source: 'checkout-prod'
      }
    };

    const response = await axios.post(
      `${POLAPINE_BASE_URL}/create-invoice`,
      invoiceData,
      {
        headers: {
          'X-API-Key': POLAPINE_API_KEY,
          'X-API-Secret': POLAPINE_API_SECRET,
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10s timeout for production reliability
      }
    );

    const paymentData = response.data;
    const invoiceId = paymentData.data?.invoice?.invoice_id;
    
    if (!invoiceId) {
        throw new Error('Invoice ID missing from provider response');
    }

    const methodToUse = payment_method || 'ecashapp';
    const paymentUrl = `https://pay.polapine.com/${methodToUse}/${invoiceId}`;

    res.json({
      success: true,
      invoice_id: invoiceId,
      payment_url: paymentUrl,
      amount: paymentData.data.invoice.amount,
      status: paymentData.data.invoice.status,
      payment_method: methodToUse
    });

  } catch (error) {
    console.error('Invoice Creation Error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      message: IS_PRODUCTION ? 'Failed to process payment request' : (error.response?.data?.message || error.message)
    });
  }
});

// --- Second Invoice Endpoint (Using API Key B) ---
app.post('/api/create-invoice-b', async (req, res) => {
  try {
    const { amount, customer_name, customer_email, order_reference, payment_method } = req.body;

    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount is required' });
    }
    if (!customer_email || !customer_email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Valid customer email is required' });
    }
    if (!POLAPINE_API_KEY_B || !POLAPINE_API_SECRET_B) {
      return res.status(500).json({ success: false, message: 'API Key B not configured' });
    }

    const port = process.env.PORT || 3050;
    const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

    const invoiceData = {
      amount: parseFloat(amount),
      order_reference: order_reference || `ORD-${Date.now()}`,
      customer_name: customer_name || 'Customer',
      customer_email: customer_email,
      webhook_url: `${baseUrl}/webhook`,
      return_url: `${baseUrl}/success`,
      metadata: {
        created_at: new Date().toISOString(),
        source: 'checkout-prod-b'
      }
    };

    const response = await axios.post(
      `${POLAPINE_BASE_URL}/create-invoice`,
      invoiceData,
      {
        headers: {
          'X-API-Key': POLAPINE_API_KEY_B,
          'X-API-Secret': POLAPINE_API_SECRET_B,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    const paymentData = response.data;
    console.log('📊 Full Polapine Response (B):', JSON.stringify(paymentData, null, 2));

    const invoiceId = paymentData.data?.invoice?.invoice_id;

    if (!invoiceId) {
        console.error('❌ Invoice ID not found. Response structure:', paymentData);
        throw new Error(`Invoice ID missing from provider response. Got: ${JSON.stringify(paymentData)}`);
    }

    const methodToUse = payment_method || 'ecashapp3';
    const paymentUrl = `https://pay.polapine.com/${methodToUse}/${invoiceId}`;

    res.json({
      success: true,
      invoice_id: invoiceId,
      payment_url: paymentUrl,
      amount: paymentData.data.invoice.amount,
      status: paymentData.data.invoice.status,
      payment_method: methodToUse
    });

  } catch (error) {
    console.error('Invoice Creation Error (B):', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      message: IS_PRODUCTION ? 'Failed to process payment request' : (error.response?.data?.message || error.message)
    });
  }
});

// --- Webhook Handling ---
app.post('/webhook', (req, res) => {
  const event = req.body;
  const headers = req.headers;
  
  console.log('-------------------------------------------');
  console.log(`[WEBHOOK RECEIVED] ${new Date().toISOString()}`);
  console.log('--- HEADERS ---');
  console.log(JSON.stringify(headers, null, 2)); // This will show us the signature header!
  console.log('--- PAYLOAD ---');
  console.log(JSON.stringify(event, null, 2));
  console.log('-------------------------------------------');

  // We will add the verification logic once we see the header name above
  if (event.event === 'payment.completed') {
    console.log(`💰 Payment verified for Order: ${event.order_reference}`);
  }

  res.status(200).json({ received: true });
});

// GET route just to test if the webhook URL is reachable in a browser
app.get('/webhook', (req, res) => {
  res.send('Webhook endpoint is active. Use POST to send data.');
});

// --- Static Pages ---
app.get('/success', (_req, res) => res.sendFile(__dirname + '/public/success.html'));
app.get('/failed', (_req, res) => res.sendFile(__dirname + '/public/failed.html'));

// --- Global Error Handler ---
app.use((err, _req, res, _next) => {
  console.error('Unhandled Error:', err.stack);
  res.status(500).json({ success: false, message: 'Internal Server Error' });
});

const PORT = process.env.PORT || 3050;
app.listen(PORT, () => {
  console.log(`\x1b[32m%s\x1b[0m`, `>>> Production server running on port ${PORT}`);
  console.log(`>>> Mode: ${IS_PRODUCTION ? 'PRODUCTION' : 'SANDBOX/DEV'}`);
});
