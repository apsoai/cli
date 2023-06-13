import { expect } from "@jest/globals";
import { getDefaultValue, Field } from "../../src/lib/entity";

const getField = (field: Field) => field;

describe("test getDefaultValue", () => {
  test("no default for text field should be set to null", () => {
    const field = getField({
      name: "test",
      type: "text",
    });
    const defaultValue = getDefaultValue(field);
    expect(defaultValue).toBe(null);
  });

  test("default should be set for text", () => {
    const field = getField({
      name: "test",
      type: "text",
      default: "testing"
    });
    const defaultValue = getDefaultValue(field);
    expect(defaultValue).toBe("testing");
  });

  test("no default for boolean should be false", () => {
    const field = getField({
      name: "test",
      type: "boolean",
    });
    const defaultValue = getDefaultValue(field);
    expect(defaultValue).toBe("false");
  })

  test("default false for boolean should be false", () => {
    const field = getField({
      name: "test",
      type: "boolean",
      default: "false"
    });
    const defaultValue = getDefaultValue(field);
    expect(defaultValue).toBe("false");
  })

  test("default true for boolean should be true", () => {
    const field = getField({
      name: "test",
      type: "boolean",
      default: "true"
    });
    const defaultValue = getDefaultValue(field);
    expect(defaultValue).toBe("true");
  })

  test("no default for integer should be null", () => {
    const field = getField({
      name: "test",
      type: "integer",
    });
    const defaultValue = getDefaultValue(field);
    expect(defaultValue).toBe(null);
  })

  test("default 0 for integer should be 0", () => {
    const field = getField({
      name: "test",
      type: "integer",
      default: "5"
    });
    const defaultValue = getDefaultValue(field);
    expect(defaultValue).toBe("5");
  })

  test("default 5 for integer should be 5", () => {
    const field = getField({
      name: "test",
      type: "boolean",
      default: "true"
    });
    const defaultValue = getDefaultValue(field);
    expect(defaultValue).toBe("true");
  })

  test("should get first value of enum", () => {
    const field = getField({
      name: "test",
      type: "enum",
      values: ["a", "b", "c"],
    });
    const defaultValue = getDefaultValue(field);
    expect(defaultValue).toBe("a");
  });

  test("should get default value for enum", () => {
    const field = getField({
      name: "test",
      type: "enum",
      values: ["a", "b", "c"],
      default: "c"
    });
    const defaultValue = getDefaultValue(field);
    expect(defaultValue).toBe("c");
  });

  test("enum with no values or default should have null", () => {
    const field = getField({
      name: "test",
      type: "enum",
    });
    const defaultValue = getDefaultValue(field);
    expect(defaultValue).toBe(null);
  });

  test("enum with invalid default throws an error", () => {
    const field = getField({
      name: "TestEnum",
      type: "enum",
      values: ["a", "b", "c"],
      default: "d"
    });
    const test = () => {
      getDefaultValue(field)
    }
    expect(test).toThrow(Error);
    expect(test).toThrow("TestEnum: Invalid default value 'd' (Valid options are: 'a', 'b', 'c')")
  });
});
