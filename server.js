require('dotenv').config();

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

require('./config/passport');

// ให้ Express ให้บริการไฟล์ในโฟลเดอร์ /uploads

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));




// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));


app.use(session({
  secret: 'your_secret_keys',
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

const homeRoutes = require('./routes/home');
const authRoutes = require('./routes/auth');
const serviceRoutes = require('./routes/services');
const bookingRoutes = require('./routes/bookings');
const reviewRoutes = require('./routes/reviews');
const profileRoutes = require('./routes/profile');

app.use(homeRoutes);
app.use(authRoutes);
app.use(serviceRoutes);
app.use(bookingRoutes);
app.use(reviewRoutes);
app.use(profileRoutes);

//technician
const technician_authRoutes = require('./routes/technician/auth');
const technician_dashboardRoutes = require('./routes/technician/dashboard');
const technician_calendarRoutes = require('./routes/technician/calendar');
const technician_bookingsRoutes = require('./routes/technician/bookings');
const technician_completedRoutes = require('./routes/technician/completed');
const technician_profileRoutes = require('./routes/technician/profile');

app.use('/technician', technician_authRoutes);
app.use('/technician/dashboard', technician_dashboardRoutes);
app.use('/technician/calendar', technician_calendarRoutes);
app.use('/technician/bookings', technician_bookingsRoutes);
app.use('/technician/completed', technician_completedRoutes);
app.use('/technician/profile', technician_profileRoutes);


//admin
const adminAuthRoutes = require('./routes/admin/auth');
const adminDashboard = require('./routes/admin/dashboard');
const adminTechnicians = require('./routes/admin/technicians');
const adminUesrs = require('./routes/admin/users');
const adminService_Categories = require('./routes/admin/service-categories');
const adminServices = require('./routes/admin/services');
const adminBookings = require('./routes/admin/bookings');
const adminPayments = require('./routes/admin/payments');


app.use('/admin', adminAuthRoutes);
app.use('/admin', adminDashboard);
app.use('/admin/technicians', adminTechnicians);
app.use('/admin/users', adminUesrs);
app.use('/admin/service-categories', adminService_Categories);
app.use('/admin/services', adminServices);
app.use('/admin/bookings', adminBookings);
app.use('/admin/payments', adminPayments);




// เริ่มเซิร์ฟเวอร์
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
