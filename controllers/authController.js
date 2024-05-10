const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const RegUser = require("../models/regUser");

exports.register = async (req, res) => {
  try {
    const { username, password } = req.body;
    const existingUser = await RegUser.findOne({ username });
    if (existingUser) {
      return res
        .status(400)
        .json({ message: "Пользователь с таким именем уже существует" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new RegUser({ username, password: hashedPassword });
    await newUser.save();
    res.status(201).json({ message: "Пользователь успешно зарегистрирован" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await RegUser.findOne({ username });
    if (!user) {
      return res.status(401).json({ message: "Неверные учетные данные" });
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Неверные учетные данные" });
    }
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);
    res.status(200).json({ token });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
