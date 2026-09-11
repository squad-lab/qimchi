import { ReactNode } from "react";
import { Panel, PanelGroup } from "react-resizable-panels";

interface BaseLayoutProps {
  rail?: ReactNode;
  sidebar: ReactNode;
  viewer: ReactNode;
  settings?: ReactNode;
}

const BaseLayout = ({ rail, sidebar, viewer }: BaseLayoutProps) => {
  return (
    // The rail sits outside the PanelGroup: react-resizable-panels sizes panels
    // as percentages of the group's own width, so a non-Panel child throws that
    // maths off and the resize handle drifts (and eventually inverts).
    <div className="flex h-full w-full">
      {rail}
      <PanelGroup
        direction="horizontal"
        className="h-full min-w-0 flex-1"
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
    </div>
  );
};

export default BaseLayout;
