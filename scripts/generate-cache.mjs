import { Octokit } from '@octokit/rest';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

// Parse GitHub issue form responses
function parseIssueForm(body) {
  const result = {
    project: '',
    maintainer: '',
    repository: '',
    urgency: 'medium',
    services: [],
    resources: [],
    wantsFundingYml: false,
    openToSponsorship: false,
  };

  // Parse Package Ecosystems section
  const packageEcosystemsSection = body.split('### Package Ecosystems')?.[1]?.split('###')?.[0]?.trim();
  
  if (packageEcosystemsSection) {
    const techs = packageEcosystemsSection
      .split('\n')
      .map(line => line.replace(/^-\s*/, '').trim())
      .filter(line => line && line !== '_No response_')
      .map(line => line.split(',').map(t => t.trim()))
      .flat()
      .filter(Boolean);
    if (techs.length) {
      result.technologies = techs;
    }
  }

  const sections = body.split('###').map(s => s.trim()).filter(Boolean);

  for (const section of sections) {
    const lines = section.split('\n');
    const header = lines[0].trim();
    const content = lines.slice(1).join('\n').trim();

    switch (header) {
      case 'Project Name':
        result.project = content.replace('_No response_', '').trim();
        break;
      
      case 'Maintainer GitHub Username':
        result.maintainer = content.replace('_No response_', '').replace('@', '').trim();
        break;
      
      case 'Project Repository':
        result.repository = content.replace('_No response_', '').trim();
        break;
      
      case 'Urgency Level':
        const urgencyMap = {
          'Low - Planning for future': 'low',
          'Medium - Needed within months': 'medium',
          'High - Needed within weeks': 'high',
          'Critical - Needed immediately': 'critical'
        };
        result.urgency = urgencyMap[content] || 'medium';
        break;

      case 'Project Size':
        {
          const size = content.replace('_No response_', '').trim().toLowerCase();
          if (['small', 'medium', 'large'].includes(size)) {
            result.projectSize = size;
          }
        }
        break;
      
      case 'Services Requested':
        {
          const serviceLines = content.split('\n');
          for (const line of serviceLines) {
            if (line.includes('- [x] ') || line.includes('- [X] ')) {
              const service = line.replace(/- \[[xX]\] /, '').trim();
              if (service && service !== '_No response_') {
                result.services.push(service);
              }
            }
          }
        }
        break;
      
      case 'Resources Requested':
        {
          const resourceLines = content.split('\n');
          for (const line of resourceLines) {
            if (line.includes('- [x] ') || line.includes('- [X] ')) {
              const resource = line.replace(/- \[[xX]\] /, '').trim();
              if (resource && resource !== '_No response_') {
                result.resources.push(resource);
              }
            }
          }
        }
        break;
      
      case 'Additional Context':
        if (content !== '_No response_') {
          result.additionalContext = content;
        }
        break;
      
      case 'FUNDING.yml Setup':
        result.wantsFundingYml = content.includes('- [x]') || content.includes('- [X]');
        break;
      
      case 'Open to Sponsorship':
      case 'Open to Honorarium':
        result.openToSponsorship = content.toLowerCase().includes('yes');
        break;
      
      case 'Timeline':
        if (content !== '_No response_') {
          result.timeline = content;
        }
        break;
      
      case 'Organization Type':
        {
          const type = content.replace('_No response_', '').trim().toLowerCase();
          if (['single-maintainer', 'community-team', 'company-team', 'foundation-team', 'other'].includes(type)) {
            result.organizationType = type;
          }
        }
        break;
      
      case 'Organization Name':
        if (content !== '_No response_') {
          result.organizationName = content;
        }
        break;
      
      case 'Additional Notes':
        if (content !== '_No response_') {
          result.additionalNotes = content;
        }
        break;
      
      case 'Preferred Practitioner':
        if (content !== '_No response_') {
          result.preferredPractitioner = content;
        }
        break;
      
      case 'Practitioner Name':
        if (content !== '_No response_') {
          result.nomineeName = content;
        }
        break;
      
      case 'Practitioner Email':
        if (content !== '_No response_') {
          result.nomineeEmail = content;
        }
        break;
      
      case 'Practitioner GitHub':
        if (content !== '_No response_') {
          result.nomineeGithub = content;
        }
        break;
    }
  }

  return result;
}

async function generateCache() {
  console.log('🔄 Fetching wishlists from GitHub Issues...');
  
  try {
    // Fetch all open issues from this repo
    const issues = await octokit.paginate('GET /repos/{owner}/{repo}/issues', {
      owner: 'oss-wishlist',
      repo: 'wishlists',
      state: 'open',
      per_page: 100,
    });

    console.log(`📦 Found ${issues.length} open wishlists`);

    const wishlists = [];

    for (const issue of issues) {
      // Parse the issue body
      const parsed = parseIssueForm(issue.body || '');
      
      const maintainerAvatarUrl = parsed.maintainer 
        ? `https://github.com/${parsed.maintainer}.png`
        : '';

      const wishlist = {
        id: issue.number,
        projectName: parsed.project || issue.title,
        repositoryUrl: parsed.repository || '',
        wishlistUrl: `/wishlist/${issue.number}`,
        maintainerUsername: parsed.maintainer,
        maintainerAvatarUrl: maintainerAvatarUrl,
        status: issue.state === 'open' ? 'Open' : 'Closed',
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        wishes: parsed.services || [],
        urgency: parsed.urgency,
        projectSize: parsed.projectSize,
        additionalNotes: parsed.additionalContext || '',
        technologies: parsed.technologies || [],
        timeline: parsed.timeline,
        organizationType: parsed.organizationType,
        organizationName: parsed.organizationName,
        openToSponsorship: parsed.openToSponsorship,
        wantsFundingYml: parsed.wantsFundingYml,
        resources: parsed.resources || [],
      };

      wishlists.push(wishlist);
    }

    // Sort by created_at descending (newest first)
    wishlists.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const cache = {
      schema_version: '1.0.0',
      generated_by: 'OSS Wishlist Sync Action',
      data_source: 'GitHub Issues (oss-wishlist/wishlists)',
      wishlists: wishlists,
      lastUpdated: new Date().toISOString(),
      count: wishlists.length,
    };

    // Write cache to file in repo root
    const cachePath = `${__dirname}/../all-wishlists.json`;
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
    
    console.log(`✅ Cache updated: ${wishlists.length} wishlists`);
    console.log(`📝 Written to: ${cachePath}`);
    
  } catch (error) {
    console.error('❌ Error generating cache:', error);
    process.exit(1);
  }
}

generateCache();
