// Configuration for API Endpoints
const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:5000'
    : ''; // Use relative path on Vercel to avoid CORS

console.log('API Base URL set to:', API_BASE_URL || 'RELATIVE');
