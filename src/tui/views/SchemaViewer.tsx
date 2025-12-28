/**
 * Schema Viewer View
 *
 * Displays the schema (entities and fields) for a service.
 */

import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { schemaApi } from "../../lib/api/services";
import { Service, ServiceSchema } from "../../lib/api/types";

interface SchemaViewerProps {
  service: Service;
  onBack: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export function SchemaViewer({
  service,
  setLoading,
  setError,
}: SchemaViewerProps): React.ReactElement {
  const [schema, setSchema] = useState<ServiceSchema | null>(null);
  const [selectedEntityIndex, setSelectedEntityIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function fetchSchema(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        const data = await schemaApi.getByServiceId(service.id);
        setSchema(data);
        setLoaded(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load schema");
      } finally {
        setLoading(false);
      }
    }

    fetchSchema();
  }, [service.id, setLoading, setError]);

  const entities = schema?.entities || [];

  useInput((input, key) => {
    if (key.upArrow && selectedEntityIndex > 0) {
      setSelectedEntityIndex(selectedEntityIndex - 1);
    }
    if (key.downArrow && selectedEntityIndex < entities.length - 1) {
      setSelectedEntityIndex(selectedEntityIndex + 1);
    }
  });

  if (!loaded) {
    return (
      <Box>
        <Text dimColor>Loading schema...</Text>
      </Box>
    );
  }

  if (!schema || entities.length === 0) {
    return (
      <Box>
        <Text dimColor>No entities defined in this service.</Text>
      </Box>
    );
  }

  const selectedEntity = entities[selectedEntityIndex];

  return (
    <Box flexDirection="row" height="100%">
      {/* Entity List (Sidebar) */}
      <Box
        flexDirection="column"
        width={30}
        borderStyle="single"
        borderRight={true}
        borderTop={false}
        borderBottom={false}
        borderLeft={false}
        paddingRight={1}
      >
        <Box marginBottom={1}>
          <Text bold>Entities</Text>
        </Box>
        {entities.map((entity, index) => (
          <Box key={entity.name}>
            <Text color={index === selectedEntityIndex ? "cyan" : undefined}>
              {index === selectedEntityIndex ? "❯ " : "  "}
              {entity.name}
            </Text>
          </Box>
        ))}
      </Box>

      {/* Field Details (Main) */}
      <Box flexDirection="column" paddingLeft={2} flexGrow={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">{selectedEntity.name}</Text>
          {selectedEntity.tableName && (
            <Text dimColor> ({selectedEntity.tableName})</Text>
          )}
        </Box>

        <Box marginBottom={1}>
          <Text bold>Fields:</Text>
        </Box>

        {selectedEntity.fields?.map((field) => (
          <FieldRow key={field.name} field={field} />
        )) || (
          <Text dimColor>No fields defined</Text>
        )}

        {selectedEntity.relationships && selectedEntity.relationships.length > 0 && (
          <>
            <Box marginTop={1} marginBottom={1}>
              <Text bold>Relationships:</Text>
            </Box>
            {selectedEntity.relationships.map((rel, index) => (
              <Box key={index}>
                <Text dimColor>  • </Text>
                <Text>{rel.type}</Text>
                <Text dimColor> → </Text>
                <Text color="yellow">{rel.target}</Text>
              </Box>
            ))}
          </>
        )}
      </Box>
    </Box>
  );
}

interface FieldRowProps {
  field: {
    name: string;
    type: string;
    nullable?: boolean;
    primaryKey?: boolean;
    unique?: boolean;
    default?: unknown;
  };
}

function FieldRow({ field }: FieldRowProps): React.ReactElement {
  const badges: string[] = [];

  if (field.primaryKey) {
    badges.push("PK");
  }
  if (field.unique) {
    badges.push("UQ");
  }
  if (!field.nullable) {
    badges.push("NN");
  }

  return (
    <Box>
      <Text dimColor>  • </Text>
      <Text>{field.name}</Text>
      <Text dimColor>: </Text>
      <Text color="green">{field.type}</Text>
      {badges.length > 0 && (
        <Text color="yellow"> [{badges.join(", ")}]</Text>
      )}
      {field.default !== undefined && (
        <Text dimColor> = {String(field.default)}</Text>
      )}
    </Box>
  );
}
