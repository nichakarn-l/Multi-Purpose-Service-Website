const express = require('express'); 
const router = express.Router();
const { isLoggedIn } = require('../middlewares/authMiddleware');
const bcrypt = require('bcrypt');
const pool = require('../db');

//edit-profile
router.get('/edit-profile', isLoggedIn, async (req, res) => {
  const userId = req.session.user.id;

  const result = await pool.query(
    `SELECT users.email,
            user_profiles.first_name, user_profiles.last_name, user_profiles.phone, user_profiles.address,
            user_profiles.latitude, user_profiles.longitude,
            user_profiles.house_number, user_profiles.road, user_profiles.suburb,
            user_profiles.district, user_profiles.city, user_profiles.postcode
    FROM users
    LEFT JOIN user_profiles ON users.id = user_profiles.user_id
    WHERE users.id = $1`,
    [userId]
  );

  const user = result.rows[0] || {}; // กัน null
  res.render('edit-profile', { user });

});
// POST บันทึกการแก้ไขโปรไฟล์
router.post('/edit-profile', async (req, res) => {
  const userId = req.session.user.id;
  let { first_name, last_name, phone, address, latitude, longitude,
      house_number, road, suburb, district, city, postcode } = req.body;


  // บังคับเป็น float ถ้ามีค่า
  latitude = latitude ? parseFloat(latitude) : null;
  longitude = longitude ? parseFloat(longitude) : null;

  const check = await pool.query('SELECT * FROM user_profiles WHERE user_id = $1', [userId]);

  if (check.rows.length === 0) {
    await pool.query(
      `INSERT INTO user_profiles
        (user_id, first_name, last_name, phone, address, latitude, longitude,
          house_number, road, suburb, district, city, postcode)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [userId, first_name, last_name, phone, address, latitude, longitude,
      house_number, road, suburb, district, city, postcode]
    );
  } else {
    await pool.query(
      `UPDATE user_profiles
        SET first_name=$1, last_name=$2, phone=$3, address=$4, latitude=$5, longitude=$6,
            house_number=$7, road=$8, suburb=$9, district=$10, city=$11, postcode=$12
        WHERE user_id=$13`,
      [first_name, last_name, phone, address, latitude, longitude,
      house_number, road, suburb, district, city, postcode, userId]
    );
  }

  res.redirect('/edit-profile');
});

module.exports = router;