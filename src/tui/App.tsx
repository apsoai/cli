/**
 * Main TUI Application
 *
 * Root component that manages application state and navigation.
 */

import React, { useState, useCallback } from "react";
import { Box, useApp, useInput } from "ink";
import { Layout } from "./components/Layout";
import { WorkspaceBrowser } from "./views/WorkspaceBrowser";
import { ServiceBrowser } from "./views/ServiceBrowser";
import { SchemaViewer } from "./views/SchemaViewer";
import { StatusBar } from "./components/StatusBar";
import { Workspace, Service } from "../lib/api/types";

export type View = "workspaces" | "services" | "schema";

interface AppState {
  view: View;
  selectedWorkspace: Workspace | null;
  selectedService: Service | null;
  isLoading: boolean;
  error: string | null;
}

export function App(): React.ReactElement {
  const { exit } = useApp();

  const [state, setState] = useState<AppState>({
    view: "workspaces",
    selectedWorkspace: null,
    selectedService: null,
    isLoading: false,
    error: null,
  });

  // Global keyboard shortcuts
  useInput((input, key) => {
    // Quit on 'q' or Ctrl+C
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
    }

    // Go back with Escape or Backspace
    if (key.escape || key.backspace) {
      handleBack();
    }
  });

  const handleBack = useCallback(() => {
    setState((prev) => {
      if (prev.view === "schema") {
        return { ...prev, view: "services", selectedService: null };
      }
      if (prev.view === "services") {
        return { ...prev, view: "workspaces", selectedWorkspace: null };
      }
      return prev;
    });
  }, []);

  const handleSelectWorkspace = useCallback((workspace: Workspace) => {
    setState((prev) => ({
      ...prev,
      view: "services",
      selectedWorkspace: workspace,
    }));
  }, []);

  const handleSelectService = useCallback((service: Service) => {
    setState((prev) => ({
      ...prev,
      view: "schema",
      selectedService: service,
    }));
  }, []);

  const setLoading = useCallback((isLoading: boolean) => {
    setState((prev) => ({ ...prev, isLoading }));
  }, []);

  const setError = useCallback((error: string | null) => {
    setState((prev) => ({ ...prev, error }));
  }, []);

  const renderView = (): React.ReactElement => {
    switch (state.view) {
      case "workspaces":
        return (
          <WorkspaceBrowser
            onSelect={handleSelectWorkspace}
            setLoading={setLoading}
            setError={setError}
          />
        );
      case "services":
        return (
          <ServiceBrowser
            workspace={state.selectedWorkspace!}
            onSelect={handleSelectService}
            onBack={handleBack}
            setLoading={setLoading}
            setError={setError}
          />
        );
      case "schema":
        return (
          <SchemaViewer
            service={state.selectedService!}
            onBack={handleBack}
            setLoading={setLoading}
            setError={setError}
          />
        );
    }
  };

  return (
    <Box flexDirection="column" height="100%">
      <Layout
        title={getTitle(state)}
        breadcrumb={getBreadcrumb(state)}
      >
        {renderView()}
      </Layout>
      <StatusBar
        isLoading={state.isLoading}
        error={state.error}
        hint={getHint(state.view)}
      />
    </Box>
  );
}

function getTitle(state: AppState): string {
  switch (state.view) {
    case "workspaces":
      return "Workspaces";
    case "services":
      return state.selectedWorkspace?.name || "Services";
    case "schema":
      return state.selectedService?.name || "Schema";
  }
}

function getBreadcrumb(state: AppState): string[] {
  const crumbs: string[] = ["Apso"];
  if (state.selectedWorkspace) {
    crumbs.push(state.selectedWorkspace.name);
  }
  if (state.selectedService) {
    crumbs.push(state.selectedService.name);
  }
  return crumbs;
}

function getHint(view: View): string {
  switch (view) {
    case "workspaces":
      return "↑↓ Navigate • Enter Select • q Quit";
    case "services":
      return "↑↓ Navigate • Enter Select • Esc Back • q Quit";
    case "schema":
      return "↑↓ Navigate • Esc Back • s Sync • q Quit";
  }
}
