export const RELEVANT_PATHS: string[];

export const shouldBuild: (options: {
  before?: string;
  after?: string;
  cwd?: string;
}) => boolean;
