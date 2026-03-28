const express = require('express');
const router = express.Router();
const pool = require('../db');
const { isLoggedIn } = require('../middlewares/authMiddleware');

router.get('/',  async (req, res) => {
    console.log('session user:', req.session.user);
    console.log('passport user:', req.user);
    try {
        const result = await pool.query('SELECT * FROM service_categories WHERE is_active = true');
        res.render('index', {
        categories: result.rows || [],
        user: req.session.user || null 
        });

    } catch (err) {
        console.error(err); // log error
        res.render('index', { categories: [] }); // ส่ง categories ว่างไปให้ index.ejs เสมอ
    }
});

module.exports = router;