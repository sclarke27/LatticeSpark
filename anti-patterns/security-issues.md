# Security Anti-Patterns

> **Security vulnerabilities that could compromise the CrowPi3 system. NEVER do these.**

---

## ❌ Anti-Pattern 1: Command Injection via User Input

**WRONG:**
```javascript
// User provides script path
async function runBridge(scriptPath) {
  // DANGEROUS: User input directly in command!
  const process = spawn('sh', ['-c', `python3 ${scriptPath}`]);
  return process;
}

// Attacker provides: "; rm -rf / #"
// Executes: python3 ; rm -rf / #
```

**WHY IT'S WRONG:**
- User input executed as shell command
- Can run ANY command
- Could delete files, install malware
- Full system compromise possible
- Critical vulnerability

**CORRECT:**
```javascript
async function runBridge(scriptPath) {
  // Validate and sanitize path
  const safePath = validateScriptPath(scriptPath);

  // NEVER use shell (-c)
  // Pass arguments separately
  const process = spawn('python3', [safePath], {
    shell: false // CRITICAL: Disable shell
  });

  return process;
}

function validateScriptPath(path) {
  // 1. Whitelist allowed scripts
  const allowedScripts = [
    'bridges/sensors/dht11_bridge.py',
    'bridges/sensors/ultrasonic_bridge.py'
  ];

  if (!allowedScripts.includes(path)) {
    throw new SecurityError('Script not allowed', { path });
  }

  // 2. Ensure path is within bridges/
  const resolved = path.resolve(path);
  const allowed = path.resolve('./bridges');

  if (!resolved.startsWith(allowed)) {
    throw new SecurityError('Path traversal attempt', { path });
  }

  // 3. Check file exists and is readable
  if (!fs.existsSync(resolved)) {
    throw new Error('Script not found');
  }

  return resolved;
}
```

---

## ❌ Anti-Pattern 2: Path Traversal

**WRONG:**
```javascript
// User provides filename
async function readConfig(filename) {
  // DANGEROUS: User could provide ../../etc/passwd
  const data = await fs.readFile(`config/${filename}`, 'utf8');
  return JSON.parse(data);
}

// Attacker provides: ../../../etc/passwd
// Reads: /etc/passwd instead of config/
```

**WHY IT'S WRONG:**
- Can read ANY file on system
- Access sensitive files (/etc/passwd, /etc/shadow)
- Read application secrets
- Data breach
- Critical vulnerability

**CORRECT:**
```javascript
async function readConfig(filename) {
  // 1. Validate filename (no path separators)
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new SecurityError('Invalid filename', { filename });
  }

  // 2. Whitelist allowed files
  const allowedFiles = ['sensors.json', 'actuators.json', 'displays.json'];
  if (!allowedFiles.includes(filename)) {
    throw new SecurityError('File not allowed', { filename });
  }

  // 3. Construct safe path
  const safePath = path.join(process.cwd(), 'config', filename);

  // 4. Verify path is within config/
  const configDir = path.resolve('./config');
  const resolved = path.resolve(safePath);

  if (!resolved.startsWith(configDir)) {
    throw new SecurityError('Path traversal attempt', {
      requested: filename,
      resolved
    });
  }

  // 5. Safe to read
  const data = await fs.readFile(resolved, 'utf8');
  return JSON.parse(data);
}
```

---

## ❌ Anti-Pattern 3: Exposing Internal Errors

**WRONG:**
```javascript
app.get('/api/sensor/:id', async (req, res) => {
  try {
    const data = await sensors.read(req.params.id);
    res.json(data);
  } catch (error) {
    // DANGEROUS: Exposes internal details!
    res.status(500).json({
      error: error.message,
      stack: error.stack, // Full stack trace!
      config: process.env // Environment variables!
    });
  }
});
```

**WHY IT'S WRONG:**
- Exposes file paths
- Reveals code structure
- Shows dependencies and versions
- May leak secrets in environment
- Helps attackers plan attacks

**CORRECT:**
```javascript
app.get('/api/sensor/:id', async (req, res) => {
  try {
    const data = await sensors.read(req.params.id);
    res.json(data);
  } catch (error) {
    // Log internally with full details
    logger.error('Sensor read failed', {
      sensorId: req.params.id,
      error: error.message,
      stack: error.stack
    });

    // Return generic error to client
    res.status(500).json({
      error: 'Internal server error',
      code: 'SENSOR_READ_FAILED',
      message: 'Unable to read sensor'
      // NO stack, NO internal details
    });
  }
});
```

---

## ❌ Anti-Pattern 4: No Input Validation

**WRONG:**
```javascript
function setSensorPin(pin) {
  // DANGEROUS: No validation!
  GPIO.setup(pin, GPIO.IN);
}

// Attacker provides: -1, 999, "../../etc/passwd", { __proto__: ... }
```

**WHY IT'S WRONG:**
- Invalid input crashes application
- Could corrupt state
- Prototype pollution possible
- Integer overflow
- Type confusion attacks

**CORRECT:**
```javascript
function setSensorPin(pin) {
  // 1. Type validation
  if (typeof pin !== 'number') {
    throw new ValidationError('Pin must be a number', {
      field: 'pin',
      value: pin,
      expectedType: 'number',
      actualType: typeof pin
    });
  }

  // 2. Integer validation
  if (!Number.isInteger(pin)) {
    throw new ValidationError('Pin must be an integer', {
      field: 'pin',
      value: pin
    });
  }

  // 3. Range validation
  if (pin < 0 || pin > 27) {
    throw new ValidationError('Pin out of range', {
      field: 'pin',
      value: pin,
      constraint: '0-27'
    });
  }

  // 4. Whitelist validation (if applicable)
  const allowedPins = [17, 18, 22, 23, 24, 25, 27];
  if (!allowedPins.includes(pin)) {
    throw new ValidationError('Pin not allowed', {
      field: 'pin',
      value: pin,
      allowedPins
    });
  }

  // Safe to use
  GPIO.setup(pin, GPIO.IN);
}
```

---

## ❌ Anti-Pattern 5: Hardcoded Secrets

**WRONG:**
```javascript
// Hardcoded in source code!
const API_KEY = 'sk_live_51HxYz2JpQr...'; // DANGEROUS
const DB_PASSWORD = 'admin123'; // DANGEROUS

// Committed to git!
// Visible in GitHub
// Can't rotate without code change
```

**WHY IT'S WRONG:**
- Secrets in source control
- Exposed in GitHub/GitLab
- Can't rotate without redeploying
- Same secret in dev/prod
- Impossible to revoke

**CORRECT:**
```javascript
// Load from environment variables
const API_KEY = process.env.API_KEY;
const DB_PASSWORD = process.env.DB_PASSWORD;

// Validate at startup
if (!API_KEY || !DB_PASSWORD) {
  throw new Error('Missing required environment variables');
}

// .env file (NEVER commit!)
// API_KEY=sk_live_...
// DB_PASSWORD=...

// .gitignore
// .env
// .env.local
// .env.*.local

// For production: Use secrets manager
// - AWS Secrets Manager
// - Azure Key Vault
// - HashiCorp Vault
```

---

## ❌ Anti-Pattern 6: Unrestricted API Access

**WRONG:**
```javascript
// No authentication!
app.post('/api/actuator/relay', async (req, res) => {
  // Anyone can control relay!
  const state = req.body.state;
  await actuators.relay.setState(state);
  res.json({ success: true });
});

// Attacker can: Turn on/off devices remotely
```

**WHY IT'S WRONG:**
- No authentication
- No authorization
- Anyone can control hardware
- Could cause physical damage
- Safety hazard

**CORRECT:**
```javascript
// 1. Bind to localhost only (not 0.0.0.0)
app.listen(3000, 'localhost', () => {
  console.log('API listening on localhost:3000');
});

// 2. Add authentication middleware
const authenticateRequest = (req, res, next) => {
  const token = req.headers['authorization'];

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Verify token
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// 3. Require authentication
app.post('/api/actuator/relay',
  authenticateRequest, // Check auth first
  async (req, res) => {
    const state = req.body.state;

    // Validate input
    if (typeof state !== 'boolean') {
      return res.status(400).json({ error: 'Invalid state' });
    }

    await actuators.relay.setState(state);
    res.json({ success: true });
  }
);

// 4. Rate limiting
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/api', limiter);
```

---

## ❌ Anti-Pattern 7: Logging Sensitive Data

**WRONG:**
```javascript
// Logs password in plain text!
logger.info('User login', {
  username: req.body.username,
  password: req.body.password, // DANGEROUS!
  apiKey: process.env.API_KEY  // DANGEROUS!
});

// Logs written to file
// Visible in log aggregators
// Sent to third-party services
```

**WHY IT'S WRONG:**
- Passwords in logs
- API keys exposed
- Compliance violations (GDPR, PCI-DSS)
- Log files accessible
- Third-party log services see secrets

**CORRECT:**
```javascript
// Redact sensitive fields
function sanitizeForLogging(obj) {
  const sanitized = { ...obj };

  const sensitiveFields = [
    'password',
    'apiKey',
    'token',
    'secret',
    'creditCard',
    'ssn'
  ];

  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  }

  return sanitized;
}

// Safe logging
logger.info('User login', sanitizeForLogging({
  username: req.body.username,
  password: req.body.password,
  apiKey: process.env.API_KEY
}));

// Outputs:
// { username: 'user@example.com', password: '[REDACTED]', apiKey: '[REDACTED]' }
```

---

## ❌ Anti-Pattern 8: Prototype Pollution

**WRONG:**
```javascript
function mergeConfig(userConfig) {
  const config = {};

  // DANGEROUS: Prototype pollution!
  for (const key in userConfig) {
    config[key] = userConfig[key];
  }

  return config;
}

// Attacker provides:
// { "__proto__": { "isAdmin": true } }
// Now ALL objects have isAdmin = true!
```

**WHY IT'S WRONG:**
- Can modify Object.prototype
- Affects all objects globally
- Bypasses security checks
- Remote code execution possible
- Critical vulnerability

**CORRECT:**
```javascript
function mergeConfig(userConfig) {
  const config = {};

  // Use Object.create(null) for no prototype
  const safeConfig = Object.create(null);

  // Only copy own properties
  for (const key of Object.keys(userConfig)) {
    // Blacklist dangerous keys
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue; // Skip dangerous keys
    }

    // Validate key type
    if (typeof key !== 'string') {
      continue;
    }

    safeConfig[key] = userConfig[key];
  }

  return safeConfig;
}

// Or use Object.assign safely
const config = Object.assign(Object.create(null), {
  // defaults
}, userConfig);

// Or use spread (ES2018+)
const config = {
  ...Object.create(null),
  ...userConfig
};
```

---

## ❌ Anti-Pattern 9: Unvalidated Redirects

**WRONG:**
```javascript
// Open redirect vulnerability
app.get('/redirect', (req, res) => {
  const url = req.query.url;
  res.redirect(url); // DANGEROUS!
});

// Attacker uses:
// /redirect?url=https://evil.com/phishing
// Users think it's your site, but redirected to attacker
```

**WHY IT'S WRONG:**
- Phishing attacks
- Credential theft
- Reputation damage
- User trust violated
- Common in OAuth flows

**CORRECT:**
```javascript
app.get('/redirect', (req, res) => {
  const url = req.query.url;

  // 1. Whitelist allowed domains
  const allowedDomains = [
    'https://crowpi3.com',
    'https://api.crowpi3.com'
  ];

  // 2. Validate URL
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (error) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // 3. Check against whitelist
  const origin = `${parsedUrl.protocol}//${parsedUrl.host}`;
  if (!allowedDomains.includes(origin)) {
    return res.status(400).json({ error: 'Redirect not allowed' });
  }

  // 4. Safe to redirect
  res.redirect(url);
});
```

---

## ❌ Anti-Pattern 10: Insufficient Rate Limiting

**WRONG:**
```javascript
// No rate limiting on expensive operations
app.post('/api/sensor/read', async (req, res) => {
  const data = await sensor.read(); // No limit!
  res.json(data);
});

// Attacker sends 1000 requests/second
// CPU maxed out
// Sensor overloaded
// System crashes
```

**WHY IT'S WRONG:**
- Denial of Service (DoS) possible
- Resource exhaustion
- Hardware damage (over-polling)
- Poor user experience
- Easy to attack

**CORRECT:**
```javascript
const rateLimit = require('express-rate-limit');

// Per-IP rate limiting
const apiLimiter = rateLimit({
  windowMs: 1000, // 1 second
  max: 10, // Max 10 requests per second per IP
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api', apiLimiter);

// Per-endpoint limiting
const sensorLimiter = rateLimit({
  windowMs: 1000,
  max: 2, // Max 2 sensor reads per second
  keyGenerator: (req) => {
    // Rate limit by sensor + IP
    return `${req.ip}:${req.params.sensor}`;
  }
});

app.post('/api/sensor/:sensor/read',
  sensorLimiter,
  async (req, res) => {
    const data = await sensor.read();
    res.json(data);
  }
);

// Hardware protection
class HardwareRateLimiter {
  #lastRead = new Map();
  #minInterval = 500; // Min 500ms between reads

  async read(sensorId) {
    const last = this.#lastRead.get(sensorId) || 0;
    const now = Date.now();

    if (now - last < this.#minInterval) {
      throw new Error('Read too frequent');
    }

    this.#lastRead.set(sensorId, now);
    return await this.#doRead(sensorId);
  }
}
```

---

## 🔍 Security Scanning Tools

```bash
# 1. npm audit (check dependencies)
npm audit
npm audit fix

# 2. Snyk (vulnerability scanning)
npx snyk test

# 3. ESLint security plugin
npm install --save-dev eslint-plugin-security
# .eslintrc.js:
# plugins: ['security']

# 4. Retire.js (check old libraries)
npm install -g retire
retire

# 5. OWASP Dependency Check
# Check for known vulnerable dependencies

# 6. Static analysis
npm install --save-dev eslint-plugin-no-unsanitized
```

---

## ✅ Security Checklist

Before deploying:

- [ ] No command injection (use array args, no shell)
- [ ] No path traversal (validate paths)
- [ ] No hardcoded secrets (use env vars)
- [ ] No sensitive data in logs (redact secrets)
- [ ] Input validation on all endpoints
- [ ] Authentication required for APIs
- [ ] Rate limiting enabled
- [ ] Bind to localhost only (or firewall)
- [ ] Error messages don't expose internals
- [ ] Dependencies up to date (npm audit clean)
- [ ] No prototype pollution (Object.create(null))
- [ ] HTTPS enabled (if network-accessible)

---

## 🎯 Quick Reference

| Vulnerability | Detection | Prevention |
|--------------|-----------|------------|
| Command injection | grep "spawn.*-c" | Use arg arrays, no shell |
| Path traversal | Test with ../../../ | Validate paths, whitelist |
| Hardcoded secrets | grep -r "password\|key" | Use env vars |
| No auth | Test endpoints | Add auth middleware |
| Exposed errors | Check 500 responses | Generic errors to client |
| Prototype pollution | Security audit | Use Object.create(null) |
| XSS | Test inputs | Sanitize all outputs |
| Rate limiting | Load test | Express-rate-limit |

---

**Remember:** Security is not optional for IoT devices. One compromised device can attack your entire network!
