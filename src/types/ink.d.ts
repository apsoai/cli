/**
 * Type declarations for Ink and related packages
 */

declare module "ink" {
  import { FC, ReactNode, ReactElement } from "react";

  export interface BoxProps {
    flexDirection?: "row" | "column" | "row-reverse" | "column-reverse";
    flexGrow?: number;
    flexShrink?: number;
    flexBasis?: string | number;
    alignItems?: "flex-start" | "center" | "flex-end" | "stretch";
    alignSelf?: "flex-start" | "center" | "flex-end" | "auto";
    justifyContent?: "flex-start" | "center" | "flex-end" | "space-between" | "space-around";
    width?: number | string;
    height?: number | string;
    minWidth?: number | string;
    minHeight?: number | string;
    padding?: number;
    paddingX?: number;
    paddingY?: number;
    paddingTop?: number;
    paddingBottom?: number;
    paddingLeft?: number;
    paddingRight?: number;
    margin?: number;
    marginX?: number;
    marginY?: number;
    marginTop?: number;
    marginBottom?: number;
    marginLeft?: number;
    marginRight?: number;
    borderStyle?: "single" | "double" | "round" | "bold" | "singleDouble" | "doubleSingle" | "classic";
    borderColor?: string;
    borderTop?: boolean;
    borderBottom?: boolean;
    borderLeft?: boolean;
    borderRight?: boolean;
    children?: ReactNode;
  }

  export const Box: FC<BoxProps>;

  export interface TextProps {
    color?: string;
    backgroundColor?: string;
    dimColor?: boolean;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    inverse?: boolean;
    wrap?: "wrap" | "truncate" | "truncate-start" | "truncate-middle" | "truncate-end";
    children?: ReactNode;
  }

  export const Text: FC<TextProps>;

  export interface Key {
    upArrow: boolean;
    downArrow: boolean;
    leftArrow: boolean;
    rightArrow: boolean;
    pageDown: boolean;
    pageUp: boolean;
    return: boolean;
    escape: boolean;
    ctrl: boolean;
    shift: boolean;
    tab: boolean;
    backspace: boolean;
    delete: boolean;
    meta: boolean;
  }

  export function useInput(
    callback: (input: string, key: Key) => void,
    options?: { isActive?: boolean }
  ): void;

  export function useApp(): {
    exit: (error?: Error) => void;
  };

  export function useStdin(): {
    stdin: NodeJS.ReadStream;
    setRawMode: (mode: boolean) => void;
    isRawModeSupported: boolean;
  };

  export function useStdout(): {
    stdout: NodeJS.WriteStream;
    write: (data: string) => void;
  };

  export function useFocus(options?: { autoFocus?: boolean; isActive?: boolean }): {
    isFocused: boolean;
  };

  export function useFocusManager(): {
    enableFocus: () => void;
    disableFocus: () => void;
    focusNext: () => void;
    focusPrevious: () => void;
  };

  export interface RenderOptions {
    stdout?: NodeJS.WriteStream;
    stdin?: NodeJS.ReadStream;
    stderr?: NodeJS.WriteStream;
    debug?: boolean;
    exitOnCtrlC?: boolean;
    patchConsole?: boolean;
  }

  export interface Instance {
    rerender: (tree: ReactElement) => void;
    unmount: () => void;
    waitUntilExit: () => Promise<void>;
    cleanup: () => void;
    clear: () => void;
  }

  export function render(tree: ReactElement, options?: RenderOptions): Instance;

  export const Newline: FC<{ count?: number }>;
  export const Spacer: FC;
  export const Static: FC<{ items: unknown[]; children: (item: unknown, index: number) => ReactElement }>;
  export const Transform: FC<{ transform: (children: string) => string; children?: ReactNode }>;
}

declare module "ink-spinner" {
  import { FC } from "react";

  export interface SpinnerProps {
    type?:
      | "dots"
      | "dots2"
      | "dots3"
      | "dots4"
      | "dots5"
      | "dots6"
      | "dots7"
      | "dots8"
      | "dots9"
      | "dots10"
      | "dots11"
      | "dots12"
      | "line"
      | "line2"
      | "pipe"
      | "simpleDots"
      | "simpleDotsScrolling"
      | "star"
      | "star2"
      | "flip"
      | "hamburger"
      | "growVertical"
      | "growHorizontal"
      | "balloon"
      | "balloon2"
      | "noise"
      | "bounce"
      | "boxBounce"
      | "boxBounce2"
      | "triangle"
      | "arc"
      | "circle"
      | "squareCorners"
      | "circleQuarters"
      | "circleHalves"
      | "squish"
      | "toggle"
      | "toggle2"
      | "toggle3"
      | "toggle4"
      | "toggle5"
      | "toggle6"
      | "toggle7"
      | "toggle8"
      | "toggle9"
      | "toggle10"
      | "toggle11"
      | "toggle12"
      | "toggle13"
      | "arrow"
      | "arrow2"
      | "arrow3"
      | "bouncingBar"
      | "bouncingBall"
      | "smiley"
      | "monkey"
      | "hearts"
      | "clock"
      | "earth"
      | "moon"
      | "runner"
      | "pong"
      | "shark"
      | "dqpb";
  }

  const Spinner: FC<SpinnerProps>;
  export default Spinner;
}

declare module "ink-text-input" {
  import { FC } from "react";

  export interface TextInputProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    focus?: boolean;
    mask?: string;
    showCursor?: boolean;
    highlightPastedText?: boolean;
    onSubmit?: (value: string) => void;
  }

  const TextInput: FC<TextInputProps>;
  export default TextInput;
}

declare module "ink-select-input" {
  import { FC, ReactNode } from "react";

  export interface Item<V> {
    label: string;
    value: V;
    key?: string;
  }

  export interface SelectInputProps<V> {
    items?: Item<V>[];
    initialIndex?: number;
    limit?: number;
    indicatorComponent?: FC<{ isSelected: boolean }>;
    itemComponent?: FC<{ isSelected: boolean; label: string }>;
    onSelect?: (item: Item<V>) => void;
    onHighlight?: (item: Item<V>) => void;
    isFocused?: boolean;
  }

  function SelectInput<V = string>(props: SelectInputProps<V>): ReactNode;
  export default SelectInput;
}
