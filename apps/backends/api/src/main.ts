import { createApplication } from "./app-factory.js";

async function bootstrap() {
  const { app } = await createApplication();
  const port = Number(process.env.PORT ?? 3200);
  await app.listen(port, process.env.HOST ?? "0.0.0.0");
}

void bootstrap();
