const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const pool = require('../db');

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
  const googleId = profile.id;
  const email = profile.emails[0].value;
  const displayName = profile.displayName;

  try {
    //ตรวจสอบว่ามีในระบบยัง
    let result = await pool.query('SELECT * FROM users WHERE google_id = $1', [googleId]);

    if (result.rows.length === 0) {
      //สร้าง users
      const insertUser = await pool.query(
        'INSERT INTO users (email, google_id, role) VALUES ($1, $2, $3) RETURNING id',
        [email, googleId, 'user']
      );

      const newUserId = insertUser.rows[0].id;

      // แยกชื่อ-นามสกุล
      const nameParts = displayName.split(' ');
      const first_name = nameParts[0] || '';
      const last_name = nameParts.slice(1).join(' ') || '';

      // บันทึกลงตาราง user_profiles
      await pool.query(
        `INSERT INTO user_profiles (user_id, first_name, last_name)
         VALUES ($1, $2, $3)`,
        [newUserId, first_name, last_name]
      );

      // ดึงข้อมูลผู้ใช้ใหม่มา
      result = await pool.query('SELECT * FROM users WHERE id = $1', [newUserId]);
    }

    const user = result.rows[0];

    //ไม่ต้องใส่ username
    done(null, {
      id: user.id,
      role: user.role
    });
  } catch (err) {
    done(err);
  }
}));

module.exports = passport;
