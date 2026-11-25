import { Global, Module } from "@nestjs/common";
import { EventsQueue } from "./events.queue";
import { EventsWorker } from "./events.worker";

@Global()
@Module({ providers: [EventsQueue, EventsWorker], exports: [EventsQueue, EventsWorker] })
export class QueueModule {}
