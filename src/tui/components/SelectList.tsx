/**
 * Select List Component
 *
 * Reusable list component with keyboard navigation.
 */

import React from "react";
import { Box, Text, useInput } from "ink";

export interface SelectListItem<T> {
  label: string;
  value: T;
  description?: string;
}

interface SelectListProps<T> {
  items: SelectListItem<T>[];
  selectedIndex: number;
  onSelect: (item: T) => void;
  onIndexChange: (index: number) => void;
  emptyMessage?: string;
}

export function SelectList<T>({
  items,
  selectedIndex,
  onSelect,
  onIndexChange,
  emptyMessage = "No items",
}: SelectListProps<T>): React.ReactElement {
  useInput((input, key) => {
    if (key.upArrow) {
      const newIndex = selectedIndex > 0 ? selectedIndex - 1 : items.length - 1;
      onIndexChange(newIndex);
    }

    if (key.downArrow) {
      const newIndex = selectedIndex < items.length - 1 ? selectedIndex + 1 : 0;
      onIndexChange(newIndex);
    }

    if (key.return && items.length > 0) {
      onSelect(items[selectedIndex].value);
    }
  });

  if (items.length === 0) {
    return (
      <Box>
        <Text dimColor>{emptyMessage}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {items.map((item, index) => (
        <SelectListItem
          key={index}
          item={item}
          isSelected={index === selectedIndex}
        />
      ))}
    </Box>
  );
}

interface SelectListItemProps<T> {
  item: SelectListItem<T>;
  isSelected: boolean;
}

function SelectListItem<T>({
  item,
  isSelected,
}: SelectListItemProps<T>): React.ReactElement {
  return (
    <Box>
      <Text color={isSelected ? "cyan" : undefined}>
        {isSelected ? "❯ " : "  "}
      </Text>
      <Text bold={isSelected} color={isSelected ? "cyan" : undefined}>
        {item.label}
      </Text>
      {item.description && (
        <Text dimColor> - {item.description}</Text>
      )}
    </Box>
  );
}
