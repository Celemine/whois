export class ResourceNotFoundError extends Error {
  constructor(msg = "resource not found") {
    super(msg);
    this.name = "ResourceNotFoundError";
  }
}

export class QueryDeniedError extends Error {
  constructor(msg = "the registry denied the query") {
    super(msg);
    this.name = "QueryDeniedError";
  }
}

export class DomainNotFoundError extends Error {
  constructor(msg = "domain not found") {
    super(msg);
    this.name = "DomainNotFoundError";
  }
}

export class NoServerError extends Error {
  constructor(resource: string) {
    super(`no server known for: ${resource}`);
    this.name = "NoServerError";
  }
}

export class ResponseTooLargeError extends Error {
  constructor(source: string) {
    super(`response from ${source} exceeds 2 MiB`);
    this.name = "ResponseTooLargeError";
  }
}
