import "dotenv/config";
import { createApp } from "./app.js";

const port = Number.parseInt(process.env.PORT || "8080", 10);
const app = createApp();
app.listen(port, "0.0.0.0", () => {
  console.log(`CodeMemory API listening on port ${port}`);
});
