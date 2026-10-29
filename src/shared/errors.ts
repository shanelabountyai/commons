// The engines' two refusals, both thrown. RULES_INVALID is a bad rules file (D-8, D-15); INPUT_INVALID is a
// malformed fixture row or an impossible tree write (T-1). Each names the field.
// Ported from quorum src/tally/errors.ts (task 1.3).

export class RulesInvalid extends Error {
  readonly code = 'RULES_INVALID' as const;
  constructor(
    readonly field: string,
    detail: string,
  ) {
    super(`RULES_INVALID: ${field}: ${detail}`);
    this.name = 'RulesInvalid';
  }
}

export class InputInvalid extends Error {
  readonly code = 'INPUT_INVALID' as const;
  constructor(
    readonly field: string,
    detail: string,
  ) {
    super(`INPUT_INVALID: ${field}: ${detail}`);
    this.name = 'InputInvalid';
  }
}
