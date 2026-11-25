import { Body, Controller, Get, HttpCode, Inject, Param, Post } from "@nestjs/common";
import { ZodPipe } from "../common/zod.pipe";
import {
  createExperimentSchema,
  visitorSchema,
  type CreateExperiment,
  type Visitor,
} from "./experiments.schemas";
import { ExperimentsService } from "./experiments.service";

@Controller("experiments")
export class ExperimentsController {
  constructor(@Inject(ExperimentsService) private readonly experiments: ExperimentsService) {}

  @Post()
  @HttpCode(201)
  create(@Body(new ZodPipe(createExperimentSchema)) body: CreateExperiment) {
    return this.experiments.create(body);
  }

  @Get(":key")
  get(@Param("key") key: string) {
    return this.experiments.state(key);
  }

  @Get(":key/audit")
  audit(@Param("key") key: string) {
    return this.experiments.audit(key);
  }

  @Post(":key/assign")
  @HttpCode(200)
  assign(@Param("key") key: string, @Body(new ZodPipe(visitorSchema)) body: Visitor) {
    return this.experiments.assign(key, body.userKey);
  }

  @Post(":key/reward")
  @HttpCode(200)
  reward(@Param("key") key: string, @Body(new ZodPipe(visitorSchema)) body: Visitor) {
    return this.experiments.reward(key, body.userKey);
  }
}
