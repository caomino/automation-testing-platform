import fetch from 'node-fetch';

async function main() {
  const res = await fetch('http://localhost:3000/api/store/bootstrap');
  const data = await res.json();
  const sysId = '04afc96b-5ea0-4108-9104-6e91363039a2';
  const sysData = data.data.systemData[sysId];
  
  if (!sysData) {
    console.error('System data not found!');
    return;
  }
  
  const payload = {
    stage: 'case',
    input: {
      systemId: sysId,
      scope: 'all',
      featureTable: sysData.featureTable,
      featurePaths: sysData.featureArtifact.featurePaths,
      featureProfiles: sysData.featureArtifact.featureProfiles,
      featureEvidence: sysData.featureArtifact.featureEvidence,
      metaConfig: { precondition: '' },
      aiConfig: {
        enabled: true,
        configId: '5ce032bc-2246-44fc-b878-a07a3a283b6f'
      }
    }
  };
  
  console.log('Sending request to generate cases with AI...');
  const postRes = await fetch('http://localhost:3000/api/stage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await postRes.json();
  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
