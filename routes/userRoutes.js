const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const authController = require("../controllers/authController");


router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/join", userController.join);
router.post("/leave", userController.leave);
router.get("/players", userController.getPlayers);
router.post("/updatepos", userController.updatePositions);
router.post("/mbbb", userController.mbBB);
router.post("/nextplayer", userController.nextTurnPlayer);
router.post("/raise", userController.raise);
router.post("/fold", userController.fold);
router.post("/coll", userController.coll);
router.get("/deal", userController.deal);
module.exports = router;
