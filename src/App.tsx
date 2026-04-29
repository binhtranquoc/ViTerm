import "./App.css";
import { AppProviders } from "@/layout/app-providers";
import { AppRouter } from "@/router/app-router";

function App() {
  return (
    <AppProviders>
      <div className="h-full w-full overflow-hidden">
        <AppRouter />
      </div>
    </AppProviders>
  );
}

export default App;
