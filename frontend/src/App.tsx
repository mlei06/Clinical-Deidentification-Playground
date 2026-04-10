import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Shell from './components/layout/Shell';
import PipelineBuilder from './components/create/PipelineBuilder';
import InferenceView from './components/inference/InferenceView';
import EvaluateView from './components/evaluate/EvaluateView';
import DictionaryManager from './components/dictionaries/DictionaryManager';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/create" element={<PipelineBuilder />} />
            <Route path="/inference" element={<InferenceView />} />
            <Route path="/evaluate" element={<EvaluateView />} />
            <Route path="/dictionaries" element={<DictionaryManager />} />
            <Route path="*" element={<Navigate to="/create" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
