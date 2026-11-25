import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

const app = await NestFactory.create(AppModule);
app.enableCors();
app.enableShutdownHooks();

const port = Number(process.env.PORT ?? 3000);
await app.listen(port);
console.log(`Tilt API listening on http://localhost:${port}`);
