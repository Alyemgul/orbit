/**
 * A hand-curated skill vocabulary for matching job posts to resumes.
 * Each row is [display label, ...aliases]. Aliases are matched as whole
 * words, case-insensitively; an alias starting with "=" is case-sensitive
 * (for words like "Go" or "React" that are also everyday English).
 */
const VOCABULARY: readonly (readonly string[])[] = [
  // Languages
  ["Python", "python"],
  ["Java", "java"],
  ["JavaScript", "javascript", "js", "ecmascript"],
  ["TypeScript", "typescript", "ts"],
  ["C++", "c++", "cpp", "modern c++"],
  ["C#", "c#", "csharp"],
  ["C", "=C", "c programming"],
  ["Go", "golang", "=Go"],
  ["Rust", "rust"],
  ["Kotlin", "kotlin"],
  ["Swift", "=Swift", "swiftui"],
  ["Scala", "scala"],
  ["Ruby", "ruby"],
  ["PHP", "php"],
  ["R", "=R", "r programming", "rstudio"],
  ["MATLAB", "matlab"],
  ["Julia", "=Julia"],
  ["Haskell", "haskell"],
  ["OCaml", "ocaml"],
  ["Elixir", "elixir"],
  ["Dart", "=Dart"],
  ["Bash", "bash", "shell scripting", "shell script"],
  ["SQL", "sql"],
  ["kdb+/q", "kdb", "kdb+", "kdb+/q"],
  ["VBA", "vba"],
  ["Solidity", "solidity"],
  ["Assembly", "assembly language", "x86 assembly", "arm assembly"],
  ["Verilog", "verilog", "systemverilog", "vhdl"],
  // Web and mobile
  ["React", "=React", "react.js", "reactjs"],
  ["Next.js", "next.js", "nextjs"],
  ["Vue", "vue", "vue.js", "vuejs", "nuxt"],
  ["Angular", "angular"],
  ["Svelte", "svelte", "sveltekit"],
  ["Node.js", "node.js", "nodejs", "=Node"],
  ["Express", "express.js", "expressjs"],
  ["NestJS", "nestjs"],
  ["Django", "django"],
  ["Flask", "flask"],
  ["FastAPI", "fastapi"],
  ["Spring Boot", "spring boot", "spring framework"],
  ["Ruby on Rails", "=Rails", "ruby on rails"],
  [".NET", ".net", "dotnet", "asp.net"],
  ["HTML", "html", "html5"],
  ["CSS", "css", "css3", "sass", "scss"],
  ["Tailwind CSS", "tailwind", "tailwindcss"],
  ["GraphQL", "graphql"],
  ["REST APIs", "restful", "rest api", "rest apis"],
  ["gRPC", "grpc", "protobuf", "protocol buffers"],
  ["WebSockets", "websocket", "websockets"],
  ["React Native", "react native"],
  ["Flutter", "flutter"],
  ["Android", "android"],
  ["iOS", "ios"],
  // Data and storage
  ["PostgreSQL", "postgresql", "postgres"],
  ["MySQL", "mysql"],
  ["SQLite", "sqlite"],
  ["MongoDB", "mongodb", "mongo"],
  ["Redis", "redis"],
  ["Elasticsearch", "elasticsearch", "opensearch"],
  ["Cassandra", "cassandra"],
  ["DynamoDB", "dynamodb"],
  ["Kafka", "kafka"],
  ["RabbitMQ", "rabbitmq"],
  ["Spark", "spark", "pyspark", "apache spark"],
  ["Hadoop", "hadoop"],
  ["Airflow", "airflow"],
  ["dbt", "dbt"],
  ["Snowflake", "snowflake"],
  ["BigQuery", "bigquery"],
  ["Databricks", "databricks"],
  ["ETL", "etl", "elt", "data pipelines", "data pipeline"],
  ["Data warehousing", "data warehouse", "data warehousing"],
  ["pandas", "pandas"],
  ["NumPy", "numpy"],
  ["SciPy", "scipy"],
  ["Polars", "polars"],
  ["Excel", "=Excel", "microsoft excel", "spreadsheets"],
  ["Power BI", "power bi", "powerbi"],
  ["Tableau", "tableau"],
  ["Looker", "looker"],
  // ML and AI
  ["Machine learning", "machine learning", "ml"],
  ["Deep learning", "deep learning", "neural networks", "neural network"],
  ["PyTorch", "pytorch", "torch"],
  ["TensorFlow", "tensorflow", "keras"],
  ["JAX", "=JAX"],
  ["scikit-learn", "scikit-learn", "sklearn"],
  ["XGBoost", "xgboost", "lightgbm", "gradient boosting"],
  ["NLP", "nlp", "natural language processing"],
  ["Computer vision", "computer vision", "opencv"],
  ["LLMs", "llm", "llms", "large language models", "large language model", "generative ai", "genai"],
  ["RAG", "=RAG", "retrieval-augmented generation", "retrieval augmented generation"],
  ["Transformers", "transformers", "hugging face", "huggingface"],
  ["Reinforcement learning", "reinforcement learning"],
  ["MLOps", "mlops"],
  ["Recommender systems", "recommender systems", "recommendation systems"],
  ["Statistics", "statistics", "statistical", "statistical modelling", "statistical modeling"],
  ["Probability", "probability"],
  ["Linear algebra", "linear algebra"],
  ["A/B testing", "a/b testing", "a/b tests", "experimentation"],
  // Cloud and infrastructure
  ["AWS", "aws", "amazon web services", "ec2", "s3", "lambda"],
  ["GCP", "gcp", "google cloud"],
  ["Azure", "azure"],
  ["Docker", "docker", "containers", "containerization"],
  ["Kubernetes", "kubernetes", "k8s", "helm"],
  ["Terraform", "terraform", "infrastructure as code"],
  ["Ansible", "ansible"],
  ["CI/CD", "ci/cd", "continuous integration", "continuous delivery", "continuous deployment"],
  ["GitHub Actions", "github actions"],
  ["Jenkins", "jenkins"],
  ["Linux", "linux", "unix"],
  ["Git", "git"],
  ["Prometheus", "prometheus"],
  ["Grafana", "grafana"],
  ["Observability", "observability", "monitoring", "opentelemetry"],
  ["Nginx", "nginx"],
  ["Serverless", "serverless"],
  ["Microservices", "microservices", "microservice", "service-oriented architecture"],
  ["Distributed systems", "distributed systems", "distributed system", "distributed computing"],
  ["System design", "system design", "software architecture"],
  ["Networking", "networking", "tcp/ip", "tcp", "udp"],
  ["Operating systems", "operating systems", "kernel"],
  ["Concurrency", "concurrency", "multithreading", "multi-threading", "parallel programming"],
  ["Low latency", "low latency", "low-latency", "high-frequency", "high frequency trading", "hft"],
  ["Performance optimisation", "performance optimization", "performance optimisation", "profiling"],
  ["Embedded systems", "embedded systems", "embedded software", "firmware", "rtos"],
  ["CUDA", "cuda", "gpu programming"],
  ["Compilers", "compilers", "compiler", "llvm"],
  // Security
  ["Security", "cybersecurity", "information security", "application security", "appsec"],
  ["Cryptography", "cryptography"],
  ["Penetration testing", "penetration testing", "pentesting", "pen testing"],
  ["OAuth", "oauth", "oauth2", "openid connect", "oidc", "sso"],
  // Practice
  ["Algorithms", "algorithms", "data structures", "data structures and algorithms"],
  ["Object-oriented design", "object-oriented", "object oriented", "oop"],
  ["Functional programming", "functional programming"],
  ["Testing", "unit testing", "unit tests", "integration testing", "test automation", "tdd", "jest", "pytest", "junit"],
  ["Code review", "code review", "code reviews"],
  ["Agile", "agile", "scrum", "kanban"],
  ["APIs", "api design", "apis"],
  ["Web scraping", "web scraping", "scraping"],
  ["Open source", "open source", "open-source"],
  // Finance and business
  ["Quantitative finance", "quantitative finance", "quant", "quantitative"],
  ["Derivatives", "derivatives", "options pricing", "options trading"],
  ["Fixed income", "fixed income", "bonds"],
  ["Risk management", "risk management", "market risk", "credit risk", "risk models"],
  ["Trading systems", "trading systems", "trading system", "order book", "execution systems", "market making"],
  ["Time series", "time series", "time-series"],
  ["Stochastic calculus", "stochastic calculus", "stochastic processes"],
  ["Financial modelling", "financial modelling", "financial modeling", "valuation", "dcf"],
  ["Accounting", "accounting"],
  ["Payments", "payments", "payment systems"],
  ["Blockchain", "blockchain", "web3", "crypto"],
  ["Product management", "product management", "roadmap", "roadmaps"],
  ["Business analysis", "business analysis", "requirements gathering", "business requirements"],
  ["Data analysis", "data analysis", "data analytics", "analytics"],
  ["Stakeholder management", "stakeholder management", "stakeholders"],
  ["Consulting", "consulting"],
  ["UX design", "ux", "ui/ux", "user experience", "figma"],
  // Languages people speak
  ["English", "=English"],
  ["German", "=German"],
  ["French", "=French"],
  ["Dutch", "=Dutch"],
  ["Spanish", "=Spanish"],
  ["Hungarian", "=Hungarian"],
  ["Japanese", "=Japanese", "jlpt"],
  ["Korean", "=Korean", "topik"],
  ["Mandarin", "=Mandarin", "=Chinese"],
];

export interface KeywordTerm {
  label: string;
  patterns: readonly RegExp[];
}

// A dot before an alias means it is part of a longer name ("Node.js" is not "js").
const BOUNDARY_BEFORE = "(?<![\\p{L}\\p{N}+#.])";
const BOUNDARY_AFTER = "(?![\\p{L}\\p{N}+#]|\\.[\\p{L}\\p{N}])";

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function compile(alias: string): RegExp {
  const caseSensitive = alias.startsWith("=");
  const word = caseSensitive ? alias.slice(1) : alias;
  // Spaces and hyphens inside a phrase match any run of either.
  const body = escape(word).replace(/\\?[ -]+/g, "[\\s-]+");
  // Single letters like "C" and "R" must not be part of "C-level", "R&D" or "C/C++".
  const after = word.length === 1 ? `(?![\\p{L}\\p{N}+#&/-])` : BOUNDARY_AFTER;
  return new RegExp(`${BOUNDARY_BEFORE}${body}${after}`, caseSensitive ? "gu" : "giu");
}

export const KEYWORD_TERMS: readonly KeywordTerm[] = VOCABULARY.map(([label, ...aliases]) => ({
  label: label!,
  patterns: aliases.map(compile),
}));

/** Occurrences of each vocabulary term in the text, keyed by label. */
export function countKeywords(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  if (!text) return counts;
  for (const term of KEYWORD_TERMS) {
    let total = 0;
    for (const pattern of term.patterns) {
      pattern.lastIndex = 0;
      total += text.match(pattern)?.length ?? 0;
    }
    if (total > 0) counts.set(term.label, total);
  }
  return counts;
}

export function findKeywords(text: string): Set<string> {
  return new Set(countKeywords(text).keys());
}
