/* TideLearn sample curriculum — AWS Solutions Architect Associate
   Each topic: note {keyConcept, points[], mnemonic}, cards[], quiz[], optional tune. */

const CURRICULUM = [
  {
    id: "s3-classes",
    name: "S3 Storage Classes",
    note: {
      keyConcept: "S3 storage classes trade retrieval speed and availability for cost — the colder the class, the cheaper the storage and the slower or pricier the retrieval.",
      points: [
        "S3 Standard: frequent access, no retrieval fee, no minimum storage duration.",
        "Standard-IA and One Zone-IA: cheaper storage, per-GB retrieval fee, 30-day minimum duration. One Zone-IA stores data in a single AZ.",
        "S3 Intelligent-Tiering moves objects between tiers automatically for a small monitoring fee — no retrieval fees.",
        "Glacier Instant Retrieval: archive pricing with millisecond access, 90-day minimum.",
        "Glacier Flexible Retrieval: minutes-to-hours access, 90-day minimum.",
        "Glacier Deep Archive: cheapest class, ~12-hour standard retrieval, 180-day minimum."
      ],
      mnemonic: "Hot to cold: Standard → IA → Glacier → Deep freeze. The colder the vault, the slower the thaw, the cheaper the bill."
    },
    cards: [
      { front: "Which S3 class stores data in a single Availability Zone?", back: "S3 One Zone-IA — ~20% cheaper than Standard-IA, but data is lost if that AZ is destroyed." },
      { front: "Minimum storage duration for Glacier Deep Archive?", back: "180 days. (Glacier Instant & Flexible: 90 days. IA classes: 30 days.)" },
      { front: "Standard retrieval time for Glacier Deep Archive?", back: "About 12 hours (bulk retrieval can take up to 48 hours)." },
      { front: "Which class auto-moves objects between access tiers?", back: "S3 Intelligent-Tiering — small per-object monitoring fee, no retrieval fees." },
      { front: "Which archive class offers millisecond retrieval?", back: "Glacier Instant Retrieval — archive storage price, real-time access, 90-day minimum." }
    ],
    quiz: [
      {
        q: "A compliance team must keep audit logs for 7 years. Logs are accessed at most once a year and a 12-hour wait is acceptable. Cheapest class?",
        opts: ["S3 Standard-IA", "S3 Intelligent-Tiering", "S3 Glacier Deep Archive", "S3 One Zone-IA"],
        a: 2,
        explain: "Rare access + tolerance for ~12h retrieval = Deep Archive, the lowest-cost class."
      },
      {
        q: "Data has unpredictable access patterns and the team wants zero retrieval fees. Best fit?",
        opts: ["S3 Standard-IA", "S3 Intelligent-Tiering", "Glacier Flexible Retrieval", "S3 One Zone-IA"],
        a: 1,
        explain: "Intelligent-Tiering optimises cost automatically and charges monitoring, not retrieval."
      }
    ],
    tune: {
      title: "The Storage Class Chant",
      bpm: 96,
      lines: [
        "Standard when it's <span class='rhyme'>hot</span>, IA when it's <span class='rhyme'>not</span>,",
        "One Zone if you're brave and can lose the <span class='rhyme'>lot</span>,",
        "Glacier for the archive — Instant if you're <span class='rhyme'>quick</span>,",
        "Deep Archive's the freezer, twelve hours is the <span class='rhyme'>trick</span>."
      ]
    }
  },
  {
    id: "ec2-purchasing",
    name: "EC2 Purchasing Options",
    note: {
      keyConcept: "Match the purchasing model to workload predictability: steady → commit for discounts, flexible → Spot, unknown → On-Demand.",
      points: [
        "On-Demand: pay per second/hour, no commitment — best for spiky or unknown workloads.",
        "Reserved Instances & Savings Plans: 1- or 3-year commitment for discounts up to ~72%.",
        "Spot Instances: spare capacity at up to ~90% off, reclaimable with a 2-minute interruption notice.",
        "Dedicated Hosts: a whole physical server — for BYOL licensing and strict compliance.",
        "Dedicated Instances: hardware isolated at the instance level, without host visibility."
      ],
      mnemonic: "Commit to save, gamble to save more: Reserved is a lease, Spot is a standby ticket with a 2-minute boarding call."
    },
    cards: [
      { front: "How much warning does AWS give before reclaiming a Spot Instance?", back: "A 2-minute interruption notice." },
      { front: "Which option suits BYOL server-bound licenses?", back: "Dedicated Hosts — you control the physical server, sockets, and cores." },
      { front: "Maximum typical discount for Spot vs On-Demand?", back: "Up to ~90% off On-Demand pricing." },
      { front: "Commitment terms for Reserved Instances / Savings Plans?", back: "1 year or 3 years (bigger discount for 3-year and upfront payment)." }
    ],
    quiz: [
      {
        q: "A fault-tolerant batch job can be stopped and restarted at any time. Most cost-effective option?",
        opts: ["On-Demand", "Reserved Instances", "Spot Instances", "Dedicated Hosts"],
        a: 2,
        explain: "Interruption-tolerant = Spot: deepest discount, 2-minute reclaim notice is acceptable."
      },
      {
        q: "A database will run 24/7 for the next 3 years. Best pricing model?",
        opts: ["Spot Instances", "On-Demand", "3-year Reserved / Savings Plan", "Dedicated Instances"],
        a: 2,
        explain: "Steady, predictable usage → commit long-term for the largest discount."
      }
    ]
  },
  {
    id: "iam-eval",
    name: "IAM Policy Evaluation",
    note: {
      keyConcept: "IAM starts from implicit deny; an explicit allow grants access; an explicit deny overrides everything.",
      points: [
        "Default state is implicit deny — no policy, no access.",
        "An explicit Allow in any applicable policy grants the action.",
        "An explicit Deny anywhere always wins, regardless of allows.",
        "Permission boundaries and SCPs cap the maximum permissions — an allow must pass every layer.",
        "Resource-based policies (e.g. S3 bucket policies) are evaluated together with identity-based policies."
      ],
      mnemonic: "Deny beats allow, and silence means no."
    },
    cards: [
      { front: "A user has Allow s3:* in one policy and Deny s3:DeleteObject in another. Can they delete objects?", back: "No — an explicit Deny always overrides any Allow." },
      { front: "What access does a brand-new IAM user have by default?", back: "None. Everything starts as implicit deny." },
      { front: "What do permission boundaries do?", back: "They cap the maximum permissions an identity can have — effective access is the intersection of boundary and policy." },
      { front: "Order of precedence in IAM evaluation?", back: "Explicit Deny > Explicit Allow > Implicit Deny." }
    ],
    quiz: [
      {
        q: "An SCP denies ec2:* on the account. A user's identity policy allows ec2:StartInstances. Result?",
        opts: ["Allowed — identity policy wins", "Denied — the SCP's deny prevails", "Allowed if using the root user", "Depends on the region"],
        a: 1,
        explain: "SCPs cap the whole account; an explicit deny at any layer blocks the action."
      },
      {
        q: "Which statement about IAM evaluation is TRUE?",
        opts: [
          "The most recently attached policy wins",
          "Resource-based policies override identity-based ones",
          "An explicit deny overrides any allow",
          "Implicit deny overrides explicit allow"
        ],
        a: 2,
        explain: "Explicit deny is absolute. Implicit deny is just the default that an allow can lift."
      }
    ],
    tune: {
      title: "The IAM Chant",
      bpm: 92,
      lines: [
        "Deny beats allow — silence means <span class='rhyme'>no</span>,",
        "Boundaries set the ceiling on how far you can <span class='rhyme'>go</span>,",
        "Bucket says yes and the user says <span class='rhyme'>too</span>?",
        "One explicit deny still blocks it for <span class='rhyme'>you</span>."
      ]
    }
  },
  {
    id: "vpc-basics",
    name: "VPC Networking Basics",
    note: {
      keyConcept: "A VPC is your private network: subnets live in one AZ each, route tables steer traffic, and gateways connect you to the world.",
      points: [
        "A subnet exists in exactly one Availability Zone.",
        "AWS reserves 5 IP addresses in every subnet (first 4 and the last).",
        "Internet Gateway gives public subnets inbound/outbound internet.",
        "NAT Gateway lives in a public subnet and gives private subnets outbound-only internet.",
        "Security groups are stateful and allow-only; NACLs are stateless with numbered allow/deny rules."
      ],
      mnemonic: "SG = Stateful Guard at the instance door; NACL = Numbered checklist at the subnet gate, asked both ways."
    },
    cards: [
      { front: "How many IPs does AWS reserve per subnet?", back: "5 — the first four addresses and the last (network, VPC router, DNS, future use, broadcast)." },
      { front: "Security group vs NACL: which is stateful?", back: "Security groups are stateful (return traffic auto-allowed). NACLs are stateless — you must allow both directions." },
      { front: "Where must a NAT Gateway be placed?", back: "In a public subnet, with a route from private subnets pointing to it." },
      { front: "Can a subnet span multiple AZs?", back: "No — one subnet maps to exactly one Availability Zone." }
    ],
    quiz: [
      {
        q: "Instances in a private subnet need to download OS patches but must not accept inbound internet traffic. What do you add?",
        opts: ["Internet Gateway route", "NAT Gateway in a public subnet", "A second Elastic IP", "VPC peering"],
        a: 1,
        explain: "NAT Gateway = outbound-only internet for private subnets."
      },
      {
        q: "Return traffic to an instance is being dropped even though the security group allows the request. Likely culprit?",
        opts: ["The stateful security group", "A stateless NACL missing an outbound/ephemeral rule", "The route table", "The Internet Gateway"],
        a: 1,
        explain: "NACLs are stateless: responses need their own allow rules (including ephemeral ports)."
      }
    ]
  },
  {
    id: "rds-vs-dynamo",
    name: "RDS vs DynamoDB",
    note: {
      keyConcept: "Choose RDS for relational SQL workloads; choose DynamoDB for key-value access at any scale with single-digit-millisecond latency.",
      points: [
        "RDS: managed relational engines; scale reads with read replicas, survive AZ failure with Multi-AZ standby.",
        "Classic RDS Multi-AZ standby is for failover only — it does not serve reads.",
        "DynamoDB: serverless key-value/document store with on-demand or provisioned capacity.",
        "DynamoDB item size limit is 400 KB.",
        "DAX adds an in-memory cache for microsecond DynamoDB reads; Global Tables replicate across regions."
      ],
      mnemonic: "Joins and transactions? RDS. Massive scale, simple keys, no servers? DynamoDB."
    },
    cards: [
      { front: "Does an RDS Multi-AZ standby serve read traffic?", back: "No — classic Multi-AZ standby exists only for failover. Use read replicas for reads." },
      { front: "DynamoDB maximum item size?", back: "400 KB per item." },
      { front: "What does DAX provide?", back: "An in-memory cache for DynamoDB delivering microsecond read latency." },
      { front: "How do you replicate DynamoDB across regions?", back: "Global Tables — multi-region, multi-active replication." }
    ],
    quiz: [
      {
        q: "An app needs complex JOINs across many tables with ACID transactions. Best fit?",
        opts: ["DynamoDB with GSIs", "RDS (relational engine)", "DynamoDB + DAX", "S3 with Athena"],
        a: 1,
        explain: "Relational modelling with joins is exactly what RDS engines are for."
      },
      {
        q: "A gaming leaderboard needs single-digit-ms reads at millions of requests/sec with a simple key. Best fit?",
        opts: ["RDS with read replicas", "DynamoDB", "Aurora Multi-AZ", "ElastiCache alone"],
        a: 1,
        explain: "Key-value at extreme scale is DynamoDB's home turf; add DAX if you need microseconds."
      }
    ]
  },
  {
    id: "lambda-limits",
    name: "Lambda Limits & Scaling",
    note: {
      keyConcept: "Lambda runs code without servers, but inside hard limits: 15-minute timeout, memory-scaled CPU, and account-level concurrency quotas.",
      points: [
        "Maximum execution timeout is 15 minutes.",
        "Memory: 128 MB to 10,240 MB — CPU allocation scales with memory.",
        "Default account concurrency quota is 1,000 concurrent executions per region (raisable).",
        "Deployment package: 50 MB zipped for direct upload, 250 MB unzipped; container images up to 10 GB.",
        "Ephemeral /tmp storage: 512 MB by default, configurable up to 10 GB."
      ],
      mnemonic: "15 minutes of fame, 10 gig of brain, a thousand at once before you complain."
    },
    cards: [
      { front: "Maximum Lambda execution time?", back: "15 minutes. Longer jobs belong in ECS/Fargate, Batch, or Step Functions." },
      { front: "How do you give a Lambda function more CPU?", back: "Increase its memory — CPU scales proportionally with the memory setting." },
      { front: "Default concurrent execution quota per region?", back: "1,000 (a soft limit you can request to raise)." },
      { front: "Maximum Lambda container image size?", back: "10 GB." }
    ],
    quiz: [
      {
        q: "A video-processing job takes ~45 minutes per file. Why is Lambda the wrong choice?",
        opts: ["Lambda can't access S3", "The 15-minute maximum timeout", "Lambda has no GPU billing", "Concurrency is capped at 10"],
        a: 1,
        explain: "45 min > the hard 15-minute limit — use Fargate, Batch, or split the work."
      },
      {
        q: "A function is CPU-bound and slow. Cheapest first lever to try?",
        opts: ["Provisioned concurrency", "Raise the memory setting", "Move to EC2", "Add an SQS queue"],
        a: 1,
        explain: "CPU scales with memory; more memory often finishes faster and can even cost less."
      }
    ]
  }
];
