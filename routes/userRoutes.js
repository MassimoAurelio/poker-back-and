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
router.post("/check", userController.check);
router.post("/fold", userController.fold);
router.post("/coll", userController.coll);
router.get("/deal", userController.deal);
router.post("/enterroom", authController.enterRoom);
router.post("/createroom", authController.createRoom);
router.get("/giveflop", userController.dealFlopCards);
router.post("/turn", userController.turn);
router.post("/winner", userController.findWinner);
router.post("/river", userController.river);
router.get("/room/:id", (req, res) => {
  res.redirect(`/room/${req.params.id}`);
});

module.exports = router;
