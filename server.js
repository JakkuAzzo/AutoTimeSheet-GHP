const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize SQLite database
const db = new Database('timesheet.db');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS timesheets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    employee_name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    timesheet_csv TEXT NOT NULL,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_user_timesheets ON timesheets(user_id);
  CREATE INDEX IF NOT EXISTS idx_submission_date ON timesheets(submitted_at);
`);

// ===== Seed Database with Default Accounts =====
async function seedDatabase() {
  const defaultAccounts = [
    { username: 'jason', email: 'jason@gmt.local', password: 'Jason123!', fullName: 'Jason', role: 'user' },
    { username: 'matthew', email: 'matthew@gmt.local', password: 'Matthew123!', fullName: 'Matthew', role: 'user' },
    { username: 'ainsley', email: 'ainsley@gmt.local', password: 'Ainsley123!', fullName: 'Ainsley', role: 'user' },
    { username: 'simon', email: 'simon@gmt.local', password: 'Simon123!', fullName: 'Simon', role: 'user' },
    { username: 'faith', email: 'faith@gmt.local', password: 'Faith123!', fullName: 'Faith', role: 'user' },
    { username: 'michelle', email: 'michelle@gmt.local', password: 'Michelle123!', fullName: 'Michelle', role: 'user' },
    { username: 'accounts', email: 'accounts@gmt.local', password: 'Accounts123!', fullName: 'Accounts Manager', role: 'admin' },
    { username: 'admin', email: 'admin@gmt.local', password: 'Admin123!', fullName: 'Administrator', role: 'admin' }
  ];

  for (const account of defaultAccounts) {
    try {
      const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(account.username);
      if (!existingUser) {
        const passwordHash = await bcrypt.hash(account.password, 10);
        db.prepare(
          'INSERT INTO users (username, email, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?)'
        ).run(account.username, account.email, passwordHash, account.fullName, account.role);
        console.log(`✓ Created account: ${account.username} (${account.role})`);
      }
    } catch (error) {
      console.error(`Error creating account ${account.username}:`, error.message);
    }
  }
}

// Call seed function
seedDatabase().catch(console.error);


// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(session({
  secret: 'gmt-timesheet-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // set to true if using HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Serve static files
app.use(express.static(__dirname));

// Authentication middleware
const requireAuth = (req, res, next) => {
  if (req.session.userId) {
    next();
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
};

// ===== AUTH ENDPOINTS =====

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password, fullName } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }

    // Check if user already exists
    const existingUser = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
    if (existingUser) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Insert user
    const result = db.prepare(
      'INSERT INTO users (username, email, password_hash, full_name) VALUES (?, ?, ?, ?)'
    ).run(username, email, passwordHash, fullName || null);

    req.session.userId = result.lastInsertRowid;
    req.session.username = username;
    req.session.userRole = 'user';

    res.json({
      success: true,
      user: { id: result.lastInsertRowid, username, email, fullName, role: 'user' }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.userRole = user.role;

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.full_name,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

// Check auth status
app.get('/api/auth/status', (req, res) => {
  if (req.session.userId) {
    const user = db.prepare('SELECT id, username, email, full_name, role FROM users WHERE id = ?').get(req.session.userId);
    res.json({ authenticated: true, user: { ...user, fullName: user.full_name } });
  } else {
    res.json({ authenticated: false });
  }
});

// Admin middleware
const requireAdmin = (req, res, next) => {
  if (req.session.userId && req.session.userRole === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Admin access required' });
  }
};

// ===== ADMIN ENDPOINTS =====

// Get dashboard stats
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  try {
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalTimesheets = db.prepare('SELECT COUNT(*) as count FROM timesheets').get().count;
    const submittedLast30Days = db.prepare("SELECT COUNT(*) as count FROM timesheets WHERE submitted_at >= datetime('now', '-30 days')").get().count;
    
    const recentTimesheets = db.prepare(
      'SELECT t.id, t.employee_name, t.start_date, t.end_date, t.submitted_at, u.username FROM timesheets t LEFT JOIN users u ON t.user_id = u.id ORDER BY t.submitted_at DESC LIMIT 10'
    ).all();
    
    res.json({
      stats: {
        totalUsers,
        totalTimesheets,
        submittedLast30Days
      },
      recentTimesheets
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Get all users (admin only)
app.get('/api/admin/users', requireAdmin, (req, res) => {
  try {
    const users = db.prepare(
      'SELECT id, username, email, full_name, role, created_at FROM users ORDER BY created_at DESC'
    ).all();
    res.json({ users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get user details by ID
app.get('/api/admin/users/:id', requireAdmin, (req, res) => {
  try {
    const user = db.prepare(
      'SELECT id, username, email, full_name, role, created_at FROM users WHERE id = ?'
    ).get(req.params.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const timesheets = db.prepare(
      'SELECT id, employee_name, start_date, end_date, submitted_at FROM timesheets WHERE user_id = ? ORDER BY submitted_at DESC'
    ).all(req.params.id);
    
    res.json({ user, timesheets });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Create new user (admin only)
app.post('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const { username, email, password, fullName, role } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password required' });
    }
    
    const existingUser = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    const result = db.prepare(
      'INSERT INTO users (username, email, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?)'
    ).run(username, email, passwordHash, fullName || null, role || 'user');
    
    res.json({ success: true, userId: result.lastInsertRowid });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update user (admin only)
app.put('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const { email, fullName, role, password } = req.body;
    const userId = req.params.id;
    
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (password) {
      const passwordHash = await bcrypt.hash(password, 10);
      db.prepare(
        'UPDATE users SET email = ?, full_name = ?, role = ?, password_hash = ? WHERE id = ?'
      ).run(email || null, fullName || null, role || 'user', passwordHash, userId);
    } else {
      db.prepare(
        'UPDATE users SET email = ?, full_name = ?, role = ? WHERE id = ?'
      ).run(email || null, fullName || null, role || 'user', userId);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete user (admin only)
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  try {
    const userId = req.params.id;
    
    // Prevent deleting self
    if (userId == req.session.userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    
    // Delete timesheets first
    db.prepare('DELETE FROM timesheets WHERE user_id = ?').run(userId);
    // Then delete user
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Get all timesheets (admin only)
app.get('/api/admin/timesheets', requireAdmin, (req, res) => {
  try {
    const timesheets = db.prepare(
      'SELECT t.id, t.user_id, t.employee_name, t.start_date, t.end_date, t.submitted_at, u.username FROM timesheets t JOIN users u ON t.user_id = u.id ORDER BY t.submitted_at DESC'
    ).all();
    res.json({ timesheets });
  } catch (error) {
    console.error('Get timesheets error:', error);
    res.status(500).json({ error: 'Failed to fetch timesheets' });
  }
});

// Get timesheet details
app.get('/api/admin/timesheets/:id', requireAdmin, (req, res) => {
  try {
    const timesheet = db.prepare(
      'SELECT t.*, u.username FROM timesheets t JOIN users u ON t.user_id = u.id WHERE t.id = ?'
    ).get(req.params.id);
    
    if (!timesheet) {
      return res.status(404).json({ error: 'Timesheet not found' });
    }
    
    res.json({ timesheet });
  } catch (error) {
    console.error('Get timesheet error:', error);
    res.status(500).json({ error: 'Failed to fetch timesheet' });
  }
});

// ===== TIMESHEET ENDPOINTS =====

// Submit timesheet
app.post('/api/timesheets/submit', requireAuth, (req, res) => {
  try {
    // Prevent admin users from submitting timesheets
    if (req.session.userRole === 'admin') {
      return res.status(403).json({ error: 'Admin users cannot submit timesheets' });
    }

    const { employeeName, startDate, endDate, timesheetCsv } = req.body;

    if (!employeeName || !startDate || !endDate || !timesheetCsv) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const result = db.prepare(
      'INSERT INTO timesheets (user_id, employee_name, start_date, end_date, timesheet_csv) VALUES (?, ?, ?, ?, ?)'
    ).run(req.session.userId, employeeName, startDate, endDate, timesheetCsv);

    res.json({
      success: true,
      timesheetId: result.lastInsertRowid
    });
  } catch (error) {
    console.error('Timesheet submission error:', error);
    res.status(500).json({ error: 'Failed to submit timesheet' });
  }
});

// Get user's timesheets
app.get('/api/timesheets', requireAuth, (req, res) => {
  try {
    const timesheets = db.prepare(
      'SELECT id, employee_name, start_date, end_date, submitted_at FROM timesheets WHERE user_id = ? ORDER BY submitted_at DESC'
    ).all(req.session.userId);

    res.json({ timesheets });
  } catch (error) {
    console.error('Fetch timesheets error:', error);
    res.status(500).json({ error: 'Failed to fetch timesheets' });
  }
});

// Get specific timesheet
app.get('/api/timesheets/:id', requireAuth, (req, res) => {
  try {
    const timesheet = db.prepare(
      'SELECT * FROM timesheets WHERE id = ? AND user_id = ?'
    ).get(req.params.id, req.session.userId);

    if (!timesheet) {
      return res.status(404).json({ error: 'Timesheet not found' });
    }

    res.json({ timesheet });
  } catch (error) {
    console.error('Fetch timesheet error:', error);
    res.status(500).json({ error: 'Failed to fetch timesheet' });
  }
});

// Serve index.html for root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close();
  process.exit(0);
});
