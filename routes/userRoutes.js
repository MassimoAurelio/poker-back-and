const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");

router.post("/join", userController.join);
router.post("/leave", userController.leave);
router.get("/players", userController.getPlayers);

module.exports = router;
