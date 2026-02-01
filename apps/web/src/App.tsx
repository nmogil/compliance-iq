import { useQuery } from 'convex/react';
import { api } from '../../convex/convex/_generated/api';

function App() {
  const jurisdictions = useQuery(api.jurisdictions.list, {});

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white shadow">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            ComplianceIQ
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Regulatory compliance research for Texas
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">
            Jurisdictions
          </h2>

          {jurisdictions === undefined ? (
            <p className="text-slate-500">Loading...</p>
          ) : jurisdictions.length === 0 ? (
            <p className="text-slate-500">
              No jurisdictions yet. Add one via the Convex dashboard.
            </p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {jurisdictions.map((j) => (
                <li key={j._id} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-900">{j.name}</p>
                    <p className="text-sm text-slate-500">{j.type}</p>
                  </div>
                  <span
                    className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                      j.isActive
                        ? 'bg-green-100 text-green-800'
                        : 'bg-slate-100 text-slate-800'
                    }`}
                  >
                    {j.isActive ? 'Active' : 'Inactive'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-8 rounded-lg bg-blue-50 border border-blue-200 p-4">
          <h3 className="text-sm font-medium text-blue-800">Connection Status</h3>
          <p className="mt-1 text-sm text-blue-700">
            {jurisdictions !== undefined
              ? 'Connected to Convex backend'
              : 'Connecting...'}
          </p>
        </div>
      </main>
    </div>
  );
}

export default App;
