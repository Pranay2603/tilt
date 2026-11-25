/** What the request path hands to the worker. Both are safe to replay. */
export type TiltEvent =
  | { type: "assign"; experiment: string; userKey: string; variant: string }
  | { type: "reward"; experiment: string; userKey: string };
