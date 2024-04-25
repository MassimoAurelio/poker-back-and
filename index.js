const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const userRoutes = require("./routes/userRoutes");
const PORT = process.env.PORT || 5000;

const app = express();

app.use(express.json());
app.use(cors({ origin: "http://localhost:3000" }));
app.use(userRoutes);

mongoose.connect("mongodb+srv://nynnwork:l4JWJjy9jKmRGuYF@poker.elzua26.mongodb.net/Poker-API?retryWrites=true&w=majority&appName=poker")
 .then(() => {
    console.log("Connected to DB");
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
 })
 .catch((error) => {
    console.log("Error connecting to DB:", error.message);
 });