import { validateDecimalField } from "../../../../lib/utils/field";
import { Field } from "../../../../lib/types";
import { describe, it, expect } from "@jest/globals";

describe("Decimal Field Validation Tests", () => {
  it("should accept valid decimal field with precision and scale", () => {
    const field: Field = {
      name: "price",
      type: "decimal",
      precision: 10,
      scale: 2,
      nullable: false,
    };

    expect(() => validateDecimalField(field)).not.toThrow();
  });

  it("should accept valid numeric field with precision and scale", () => {
    const field: Field = {
      name: "amount",
      type: "numeric",
      precision: 16,
      scale: 6,
      nullable: false,
    };

    expect(() => validateDecimalField(field)).not.toThrow();
  });

  it("should accept decimal field without precision and scale (uses defaults)", () => {
    const field: Field = {
      name: "value",
      type: "decimal",
      nullable: false,
    };

    expect(() => validateDecimalField(field)).not.toThrow();
  });

  it("should throw error for invalid precision (too low)", () => {
    const field: Field = {
      name: "price",
      type: "decimal",
      precision: 0,
      scale: 2,
      nullable: false,
    };

    expect(() => validateDecimalField(field)).toThrow(
      "price: Invalid precision value 0. Must be between 1 and 131072."
    );
  });

  it("should throw error for invalid precision (too high)", () => {
    const field: Field = {
      name: "price",
      type: "decimal",
      precision: 200_000,
      scale: 2,
      nullable: false,
    };

    expect(() => validateDecimalField(field)).toThrow(
      "price: Invalid precision value 200000. Must be between 1 and 131072."
    );
  });

  it("should throw error for invalid scale (too low)", () => {
    const field: Field = {
      name: "price",
      type: "decimal",
      precision: 10,
      scale: -1,
      nullable: false,
    };

    expect(() => validateDecimalField(field)).toThrow(
      "price: Invalid scale value -1. Must be between 0 and 16383."
    );
  });

  it("should throw error for invalid scale (too high)", () => {
    const field: Field = {
      name: "price",
      type: "decimal",
      precision: 10,
      scale: 20_000,
      nullable: false,
    };

    expect(() => validateDecimalField(field)).toThrow(
      "price: Invalid scale value 20000. Must be between 0 and 16383."
    );
  });

  it("should throw error when scale exceeds precision", () => {
    const field: Field = {
      name: "price",
      type: "decimal",
      precision: 5,
      scale: 10,
      nullable: false,
    };

    expect(() => validateDecimalField(field)).toThrow(
      "price: Scale (10) cannot be greater than precision (5)."
    );
  });

  it("should not validate non-decimal fields", () => {
    const field: Field = {
      name: "name",
      type: "text",
      nullable: false,
    };

    expect(() => validateDecimalField(field)).not.toThrow();
  });

  it("should not validate non-numeric fields", () => {
    const field: Field = {
      name: "active",
      type: "boolean",
      nullable: false,
    };

    expect(() => validateDecimalField(field)).not.toThrow();
  });
});
