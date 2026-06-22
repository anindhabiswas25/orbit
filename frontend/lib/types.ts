export interface VaultStatus {
  vaultBalance:        number;
  currentProtocol:     string;
  currentProtocolName: string;
  currentAPY:          number;
  currentAPYFormatted: string;
  bestProtocol:        string;
  bestProtocolName:    string;
  bestAPY:             number;
  bestAPYFormatted:    string;
  lastScoutAt:         number;
}

export interface Protocol {
  name:         string;
  address:      string;
  apy:          number;
  apyFormatted: string;
  isActive:     boolean;
  error:        boolean;
}

export interface Agent {
  wallet:          string;
  developerWallet: string;
  type:            'Scout' | 'Executor';
  status:          'Active' | 'Paused' | 'Deregistered' | 'Banned';
  endpoint:        string;
  fee:             number;
  feeFormatted:    string;
  stake:           number;
  reputation:      number;
  jobsCompleted:   number;
  jobsFailed:      number;
  registeredAt:    number;
}

export interface Job {
  jobId:      number;
  type:       'Scout' | 'Executor';
  agent:      string;
  assignedAt: number;
  deadline:   number;
  status:     'Pending' | 'Completed' | 'Failed' | 'Expired';
  assignedTx: string | null;
  resultTx:   string | null;
}

export interface RebalanceEvent {
  fromProtocol?: string;
  toProtocol?:   string;
  fromName:      string;
  toName:        string;
  fromAPY:       number;
  toAPY:         number;
  fromFormatted: string;
  toFormatted:   string;
  amount:        number;
  timestamp:     number;
  executorAgent: string;
  gain:          number;
  gainFormatted: string;
  txHash:        string | null;
}

export interface Meta {
  chainId:      number;
  network:      string;
  explorerBase: string;
  contracts:    Record<string, string>;
}
