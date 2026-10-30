const express = require('express');
const {
  summary,
  listUsers,
  trends,
  updateUser,
} = require('../controllers/adminController');
const { auth, adminOnly } = require('../middlewares/auth');

const router = express.Router();

router.use(auth, adminOnly);

router.get('/summary', summary);
router.get('/trends', trends);
router.get('/users', listUsers);
router.patch('/users/:id', updateUser);

module.exports = router;
