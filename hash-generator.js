import bcrypt from "bcrypt";

const password = "1234";
const saltRounds = 10;

bcrypt.hash(password, saltRounds, (err, hash) => {
  if (err) throw err;
  console.log("Hash de 1234:", hash);
});