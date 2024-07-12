const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const authController = require("../controllers/authController");
router.get("/players", userController.getPlayers);
router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/leave", userController.leave);
router.post("/nextplayer", userController.nextTurnPlayer);
router.post("/raise", userController.raise);
router.post("/check", userController.check);
router.post("/fold", userController.fold);
router.post("/coll", userController.coll);
router.post("/enterroom", authController.enterRoom);
router.post("/createroom", authController.createRoom);
router.get("/room/:id", (req, res) => {
  res.redirect(`/room/${req.params.id}`);
});

module.exports = router;
