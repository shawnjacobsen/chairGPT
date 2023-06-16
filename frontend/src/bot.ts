// handle any bot related behavior including Q/A and embedding
import { Configuration, OpenAIApi } from 'openai'
import { getSharepointChunk, userHasAccessToFile } from './sharepoint'
import { cleanStringToAscii, sleep } from './helpers'


export function getOpenAIApiObject():OpenAIApi {
  const configuration = new Configuration({
    apiKey: process.env.REACT_APP_KEY_OPENAI,
  });
  const openai = new OpenAIApi(configuration)
  return openai
}

export function gptEmbedding(OpenAI:OpenAIApi, content:string, engine='text-embedding-ada-002'):Array<number> {
  return []
}


/**
 * Return Sharepoint documents similar to some vector which are accessible to the specified user as a single combined text string
 * @param vdb pinecone DB to query for pinecone
 * @param accessTokenAD returned auth token from login.microsoftonline.com
 * @param vector the vector to search for similar vectors of in the vector database
 * @param k number of semantically similar documents to poll for at a time. Defaults to 6.
 * @param threshold min number of documents to return. Defaults to 2.
 * @param maxTries number of repolls to reach threshold. Defaults to 3.
 * @param infoSeparator text separator indicator used when joininig all gathered information
 * @returns concatentated list of similar documents content
 */
export function retrieveAccessibleSimilarInformation(
  vdb:any,
  accessTokenAD:string,
  vector:Array<number>,
  k:number=2,
  threshold:number=2,
  maxTries:number=3,
  infoSeparator:string=" -- "
):string {

  let preivouslyQueriedVectors = []
  let numAccessibleDocuments = 0
  let accessibleDocuments = ""
  let tries = 0

  while (numAccessibleDocuments < threshold && tries < maxTries) {
    // for current try, retrieve k + number of previously queried vectors to get new vectors
    const numVectorsToRetrieve = k + preivouslyQueriedVectors.length
    // query response { 'matches': [{'id','score','values', 'metadata':{ 'document_id', 'chunk_index' }}] }
    // TODO: format vdb query according to pinecone js sdk
    const response = vdb.query(vector=vector, numVectorsToRetrieve, true, preivouslyQueriedVectors)
    let matches = response['matches']
    const ids = matches.map(match => match['id'])

    // filter out elements in matches whose id is in preivouslyQueriedVectors
    matches = matches.filter(match => preivouslyQueriedVectors.some(id => id !== match['id']))

    // append chunk content if the user has access
    matches.forEach(match => {
      const docId = match['metadata']['document_id']
      const chunkIndex = match['metadata']['chunk_index']
      const userHasAccess = userHasAccessToFile(accessTokenAD, docId)
      if (userHasAccess === true) {
        const docContents = getSharepointChunk(accessTokenAD, docId, chunkIndex)
        accessibleDocuments += docContents + infoSeparator
        numAccessibleDocuments += 1
      }
    })
    
    // increment number of tries and update previously queried vectors
    preivouslyQueriedVectors.concat(ids)
    tries += 1
  }
  return accessibleDocuments
}

/**
 * Get answer to some generic text prompt via OpenAI's GPT models
 * @param openai OpenAI object 
 * @param prompt Entire text prompt to be provided to model
 * @param model specified OpenAI model to use
 * @param temp model temp
 * @param top_p model parameter
 * @param tokens max tokens in response
 * @param freq_pen model parameter
 * @param pres_pen model parameter
 * @param stop 
 * @return model's response to the prompt
 */
export async function gptCompletion(
  openai:OpenAIApi,
  prompt:string,
  model:string='gpt-3.5-turbo',
  temp=0.0,
  top_p=1.0,
  tokens=400,
  freq_pen=0.0,
  pres_pen=0.0,
  stop=['USER:', 'ASSISTANT:']):Promise<string> {

  const maxRetry = 5
  let retry = 0
  // fix any possible ascii issues
  prompt = cleanStringToAscii(prompt)


  while (true) {
    try {
      const response:any = await openai.createCompletion({
        model:model,
        prompt: prompt,
        temperature: temp,
        max_tokens: tokens,
        top_p: top_p,
        frequency_penalty: freq_pen,
        presence_penalty: pres_pen,
        stop: stop
      })
      let text = response.data.choices[0].text
      text.replace('\r\n','\n')
      text.replace('\t','  ')
      return text
    } catch(e) {
      retry += 1
      console.log(`ERROR: Could not communicate with OpenAI.\n${e}`)
      if (retry > maxRetry) {
        return "Sorry, I am unable to respond to that right now. Please try again later."
      }
      sleep(1000)
    }
  }
}

/**
 * constrcits a prompt with conversational context and information to be fed to the LLM
 * @param previousPrompterMsg message from previous Q/A exchange for context
 * @param previousResponderMsg message from previous Q/A exchange for context
 * @param currPrompterMsg current prompter's message to be responded to
 * @param contextInfo any additional info to be provided to the model
 * @param promptTemplate text file location of prompt template
 * @return constructed prompt
 */
export async function construct_prompt(
  previousPrompterMsg:string,
  previousResponderMsg:string,
  currPrompterMsg:string,
  contextInfo:string,
  promptTemplate:string='/prompt.txt'
):Promise<string> {
  const response = await fetch(promptTemplate)
  let prompt = await response.text()
  prompt = prompt.replace("<<USER CONTEXT>>", previousPrompterMsg)
  prompt = prompt.replace("<<BOT CONTEXT>>", previousResponderMsg)
  prompt = prompt.replace("<<MESSAGE>>", currPrompterMsg)
  prompt = prompt.replace("<<INFO>>", contextInfo)
  return prompt
}