import express from "express";
import cors from "cors";
import healthRoutes from "./routes/health.js";
import costsRoutes from "./routes/costs.js";

const app = express();
const PORT = process.env.PORT || 3011;

app.use(cors());
app.use(express.json());

app.use(healthRoutes);
app.use(costsRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

if (process.env.NODE_ENV !== "test") {
  app.listen(Number(PORT), "::", () => {
    console.log(`Costs service running on port ${PORT}`);
  });
}

export default app;
