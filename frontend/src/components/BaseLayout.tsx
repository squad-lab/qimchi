import { ReactNode } from "react";
import { Panel, PanelGroup } from "react-resizable-panels";

interface BaseLayoutProps {
  sidebar: ReactNode;
  viewer: ReactNode;
  settings?: ReactNode;
}

const BaseLayout = ({ sidebar, viewer }: BaseLayoutProps) => {
  return (
    <PanelGroup
      direction="horizontal"
      className="h-screen"
      autoSaveId="qimchi-main-layout"
    >
      {/* Sidebar */}
      {sidebar && <>{sidebar}</>}

      {/* Viewer */}
      <Panel defaultSize={60} className="bg-gray-50">
        <PanelGroup direction="vertical" className="h-full">
          <Panel className="bg-gray-100 p-0">
            <div className="h-full">{viewer}</div>
          </Panel>
          {/* CONCERN: We could have the settings here too, sliding from below */}
          {/* <PanelResizeHandle className="h-1.5 bg-gray-300 hover:bg-blue-500 transition-colors" /> */}
        </PanelGroup>
      </Panel>

      {/* Settings */}
      {/* TODOLATER: See what can be grouped into this */}
      {/* {settings && (
        <>
          <PanelResizeHandle className="w-1.5 bg-gray-300 hover:bg-blue-500 transition-colors" />
          <Panel
            defaultSize={20}
            collapsible={true}
            minSize={0}
            className="bg-gray-100 p-4"
          >
            <div className="h-full">{settings}</div>
          </Panel>
        </>
      )} */}
    </PanelGroup>
  );
};

export default BaseLayout;
